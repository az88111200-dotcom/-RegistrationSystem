/**
 * 人機驗證。
 *
 * 有設定 Cloudflare Turnstile（TURNSTILE_SITE_KEY + TURNSTILE_SECRET_KEY）時用 Turnstile：
 *   頁面在背景自動確認是不是真人，絕大多數人什麼都不用做；
 *   Cloudflare 覺得可疑時才會跳出一個方塊讓人點一下。不會叫人輸入數字或點紅綠燈。
 *   送出時把 Turnstile 給的通行碼帶來，這裡拿去問 Cloudflare 是真的才放行。
 *   陷阱欄位照樣檢查。
 *
 * 還沒設定 Turnstile 時，用下面這套自己做的（不用任何金鑰）：
 *
 * 第一層（看不到）
 *   1. 入場券：打開頁面時領一張有簽章的券（時間 + 亂數，用 SESSION_SECRET 簽）。
 *      送出時要帶回來。沒帶、偽造、或是打開頁面不到幾秒就送出（真人填不了那麼快）都算可疑。
 *   2. 陷阱欄位：表單裡藏一格人看不到的「網站」欄。機器人會把每一格都填滿，填了就擋。
 *   3. 次數：同一個 IP 十分鐘內送太多次算可疑。記在資料庫，Vercel 換機器也算得到。
 *
 * 第二層（只有可疑時）
 *   出一題「兩位數＋一位數」，數字畫成歪斜的線條圖（不是文字，程式沒辦法直接讀），答對就放行。
 *   每一題只能答一次，答錯換新題；十分鐘內答錯太多次先擋。
 *   學校同一個 wifi 一整班一起報名時，頂多偶爾遇到一題，不會整個被擋。
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { SESSION_SECRET } from './config.js';
import { query } from './db.js';
import { clientIp } from './http.js';
import { todayInTaipei } from './util.js';

/**
 * 人機驗證目前停用（有人一直過不了，先關掉）。
 * 要再打開：在 Vercel 環境變數設 HUMAN_CHECK=1，重新部署。
 * 關掉時什麼都不檢查，前台也不會載入 Cloudflare。
 */
export const HUMAN_CHECK_ON = String(process.env.HUMAN_CHECK ?? '0').trim() === '1';

/**
 * Cloudflare Turnstile。site key 是公開的（會給瀏覽器），secret key 只放在 Vercel 環境變數。
 * TURNSTILE_VERIFY_URL 只有本機測試會用到（假的 Cloudflare）。
 */
export const TURNSTILE_SITE_KEY = String(process.env.TURNSTILE_SITE_KEY || '').trim();
const TURNSTILE_SECRET_KEY = String(process.env.TURNSTILE_SECRET_KEY || '').trim();
export const TURNSTILE_ON = Boolean(TURNSTILE_SITE_KEY && TURNSTILE_SECRET_KEY);
const TURNSTILE_VERIFY_URL = process.env.TURNSTILE_VERIFY_URL
  || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** 打開頁面之後最快幾秒送出還算真人。簽到、查詢本來就很快，給短一點。 */
const MIN_SECONDS = {
  register: 6, booking: 5, survey: 4, checkin: 2, lookup: 2, admin: 1,
};
/** 入場券多久過期（填到一半去吃飯回來也要能送，給一天） */
const TICKET_TTL_MS = 24 * 60 * 60 * 1000;
/** 題目要在幾分鐘內答 */
const CHALLENGE_TTL_MS = 10 * 60 * 1000;
/**
 * 同一個 IP 十分鐘內送幾次之後開始出題。
 * 簽到與前後測一整班常常在同一個 wifi 下一起做，給寬一點。
 */
const WINDOW_MS = 10 * 60 * 1000;
const LIMITS = {
  register: Number(process.env.HUMAN_LIMIT_REGISTER) || 20,
  booking: Number(process.env.HUMAN_LIMIT_BOOKING) || 10,
  survey: Number(process.env.HUMAN_LIMIT_SURVEY) || 60,
  checkin: Number(process.env.HUMAN_LIMIT_CHECKIN) || 80,
  lookup: Number(process.env.HUMAN_LIMIT_LOOKUP) || 20,
  // 後台登入另外有「輸錯 10 次鎖 15 分鐘」，這裡只是多一道
  admin: 30,
  // 十分鐘內答錯幾題之後先擋
  wrong: 8,
};

const sign = (text) => createHmac('sha256', `human:${SESSION_SECRET}`).update(text).digest('base64url');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

// ---------------------------------------------------------------- 入場券

export function issueTicket(now = Date.now()) {
  const body = `${now}.${randomBytes(9).toString('base64url')}`;
  return `${body}.${sign(`t:${body}`)}`;
}

/** 入場券有沒有問題。回傳 ''＝沒問題，不然是原因（記錄用，不給使用者看）。 */
export function ticketProblem(ticket, kind, now = Date.now()) {
  const parts = String(ticket || '').split('.');
  if (parts.length !== 3) return 'no-ticket';
  const [issued, nonce, mac] = parts;
  if (!safeEqual(mac, sign(`t:${issued}.${nonce}`))) return 'bad-signature';
  const age = now - Number(issued);
  if (!Number.isFinite(age) || age < 0) return 'bad-time';
  if (age > TICKET_TTL_MS) return 'expired';
  if (age < (MIN_SECONDS[kind] ?? 3) * 1000) return 'too-fast';
  return '';
}

// ---------------------------------------------------------------- 次數

/** 記一次，回傳這十分鐘內第幾次（存資料庫，換機器也算得到）。 */
export async function countHit(kind, ip, now = Date.now()) {
  const key = `${kind}:${ip || 'unknown'}`;
  const { rows } = await query(
    `INSERT INTO human_hits (key, window_start, count) VALUES ($1, $2, 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN human_hits.window_start < $2 - $3 THEN 1 ELSE human_hits.count + 1 END,
       window_start = CASE WHEN human_hits.window_start < $2 - $3 THEN $2 ELSE human_hits.window_start END
     RETURNING count`,
    [key, now, WINDOW_MS],
  );
  return Number(rows[0].count);
}

export const overLimit = (kind, count) => count > (LIMITS[kind] || 20);

// ---------------------------------------------------------------- 題目

/*
 * 數字用七段顯示器的筆畫畫，每一筆加一點歪斜，整個字再隨機轉一點角度。
 * SVG 裡只有線條座標、沒有文字，程式拿到圖也讀不出數字是多少。
 */
const SEGMENTS = {
  0: 'abcdef', 1: 'bc', 2: 'abdeg', 3: 'abcdg', 4: 'bcfg',
  5: 'acdfg', 6: 'acdefg', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg',
};
const SEG_LINES = {
  a: [[0, 0], [1, 0]], b: [[1, 0], [1, 1]], c: [[1, 1], [1, 2]], d: [[0, 2], [1, 2]],
  e: [[0, 1], [0, 2]], f: [[0, 0], [0, 1]], g: [[0, 1], [1, 1]],
};
const rand = (min, max) => min + Math.random() * (max - min);
const jitter = (v) => v + rand(-2.2, 2.2);

function glyph(ch, x, y, w, h) {
  if (ch === '+') {
    return [
      [[x + w * 0.1, y + h / 2], [x + w * 0.9, y + h / 2]],
      [[x + w / 2, y + h * 0.25], [x + w / 2, y + h * 0.75]],
    ];
  }
  if (ch === '=') {
    return [
      [[x + w * 0.1, y + h * 0.4], [x + w * 0.9, y + h * 0.4]],
      [[x + w * 0.1, y + h * 0.6], [x + w * 0.9, y + h * 0.6]],
    ];
  }
  if (ch === '?') {
    return [
      [[x, y + h * 0.1], [x + w, y + h * 0.1]], [[x + w, y + h * 0.1], [x + w, y + h * 0.5]],
      [[x + w, y + h * 0.5], [x + w / 2, y + h * 0.5]], [[x + w / 2, y + h * 0.5], [x + w / 2, y + h * 0.72]],
      [[x + w / 2, y + h * 0.88], [x + w / 2, y + h * 0.95]],
    ];
  }
  return [...(SEGMENTS[ch] || '')].map((s) => SEG_LINES[s].map(([px, py]) => [x + px * w, y + (py / 2) * h]));
}

function challengeSvg(text) {
  const W = 220;
  const H = 70;
  const lines = [];
  let x = 14;
  for (const ch of text) {
    if (ch === ' ') { x += 8; continue; }
    const w = ch === '1' ? 0 : 18;
    const ox = ch === '1' ? x + 9 : x;
    const angle = rand(-12, 12).toFixed(1);
    const cx = ox + 9;
    const strokes = glyph(ch, ox, 16 + rand(-4, 4), Math.max(w, 1), 38)
      .map(([[x1, y1], [x2, y2]]) => `<line x1="${jitter(x1).toFixed(1)}" y1="${jitter(y1).toFixed(1)}" x2="${jitter(x2).toFixed(1)}" y2="${jitter(y2).toFixed(1)}"/>`)
      .join('');
    lines.push(`<g transform="rotate(${angle} ${cx} 35)">${strokes}</g>`);
    x += 26;
  }
  // 幾條干擾線
  const noise = Array.from({ length: 5 }, () => `<line x1="${rand(0, W).toFixed(0)}" y1="${rand(0, H).toFixed(0)}" x2="${rand(0, W).toFixed(0)}" y2="${rand(0, H).toFixed(0)}" stroke="#9fb7a8" stroke-width="1.3"/>`).join('');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`
    + `<rect width="${W}" height="${H}" rx="10" fill="#f1f7f2"/>${noise}`
    + `<g stroke="#0b3d23" stroke-width="4" stroke-linecap="round" fill="none">${lines.join('')}</g></svg>`;
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

/** 出一題。答案不放在回傳的資料裡，只放簽章過的雜湊。 */
export function makeChallenge(now = Date.now()) {
  // 兩位數加一位數：小朋友算得出來，答案又有將近 50 種，亂猜很難猜中
  const a = 10 + Math.floor(Math.random() * 40);
  const b = 1 + Math.floor(Math.random() * 9);
  const nonce = randomBytes(9).toString('base64url');
  const token = `${now}.${nonce}.${sign(`c:${now}.${nonce}:${a + b}`)}`;
  return { token, image: challengeSvg(`${a} + ${b} = ?`) };
}

export function challengePassed(token, answer, now = Date.now()) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return false;
  const [issued, nonce, mac] = parts;
  const age = now - Number(issued);
  if (!Number.isFinite(age) || age < 0 || age > CHALLENGE_TTL_MS) return false;
  // 全形數字也收（手機中文輸入法常打出全形）
  const value = String(answer ?? '').replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xFF10)).trim();
  if (!/^\d{1,3}$/.test(value)) return false;
  return safeEqual(mac, sign(`c:${issued}.${nonce}:${Number(value)}`));
}

// ---------------------------------------------------------------- Turnstile

/**
 * 拿通行碼去問 Cloudflare。回傳 'ok'、'fail'，或 'unreachable'（Cloudflare 連不上）。
 * 每個通行碼只能用一次、五分鐘內有效，這些 Cloudflare 會幫忙檢查。
 */
async function turnstileVerdict(token, ip) {
  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret: TURNSTILE_SECRET_KEY, response: token, ...(ip ? { remoteip: ip } : {}) }),
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return 'unreachable';
    const data = await res.json();
    if (data.success) return 'ok';
    console.warn('[turnstile] 沒通過', (data['error-codes'] || []).join(','));
    return 'fail';
  } catch (err) {
    console.warn('[turnstile] 連不上 Cloudflare', err.message);
    return 'unreachable';
  }
}

const turnstileError = (message) => Object.assign(new Error(message), {
  status: 428, expected: true, extra: { turnstile: true },
});

/** 從 User-Agent 看出大概是什麼瀏覽器（只留種類跟版本，方便找原因） */
export function browserKind(ua = '') {
  if (/\bLine\//i.test(ua)) return 'LINE 內建瀏覽器';
  if (/Instagram/i.test(ua)) return 'Instagram 內建瀏覽器';
  if (/FBAN|FBAV|FB_IAB/i.test(ua)) return 'Facebook 內建瀏覽器';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung 瀏覽器';
  const ios = /iPhone|iPad|iPod/.test(ua) ? (ua.match(/OS (\d+)_/) || [])[1] : null;
  if (ios) return `iPhone iOS ${ios}${/CriOS/.test(ua) ? ' Chrome' : ' Safari'}`;
  if (/Android/.test(ua)) {
    const v = (ua.match(/Android (\d+)/) || [])[1] || '';
    return `Android ${v}${/Chrome\//.test(ua) ? ' Chrome' : ''}`.replace(/\s+/g, ' ').trim();
  }
  if (/Edg\//.test(ua)) return '電腦 Edge';
  if (/Chrome\//.test(ua)) return '電腦 Chrome';
  if (/Firefox\//.test(ua)) return '電腦 Firefox';
  if (/Safari\//.test(ua)) return 'Mac Safari';
  return '其他';
}

/** 記一筆「Cloudflare 在這個人的瀏覽器過不了」，後台首頁看得到 */
async function recordFailure(req, code) {
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim().slice(0, 120);
  try {
    await query(
      `INSERT INTO human_failures (day, code, browser, host, count) VALUES ($1, $2, $3, $4, 1)
       ON CONFLICT (day, code, browser, host) DO UPDATE SET count = human_failures.count + 1`,
      [todayInTaipei(), code, browserKind(String(req.headers['user-agent'] || '')), host || '?'],
    );
  } catch (err) {
    console.warn('[turnstile] 記錄失敗原因時出錯', err.message);
  }
}

/** 後台：最近幾天 Cloudflare 驗證過不了的紀錄 */
export async function recentFailures(days = 14) {
  const since = new Date(Date.parse(todayInTaipei()) - days * 86400000).toISOString().slice(0, 10);
  const { rows } = await query(
    `SELECT code, browser, host, SUM(count)::int AS count, MAX(day) AS last_day
       FROM human_failures WHERE day >= $1
      GROUP BY code, browser, host ORDER BY SUM(count) DESC LIMIT 30`,
    [since],
  );
  return rows.map((r) => ({
    code: r.code, browser: r.browser, host: r.host, count: r.count, lastDay: r.last_day,
  }));
}

/**
 * 回傳 true＝Cloudflare 驗過了；false＝這個人的瀏覽器過不了 Cloudflare，改用備用檢查。
 * 前台拿不到通行碼（被擋、瀏覽器太舊、網址沒加進 Cloudflare……）會帶 turnstileFailed 來，
 * 這時不能讓人卡住，改走跟沒設定 Turnstile 時一樣的檢查。
 */
async function checkTurnstile(req, ip, h) {
  const failed = String(h.turnstileFailed || '').trim().replace(/[^\w.-]/g, '').slice(0, 40);
  const token = String(h.turnstile || '').trim();
  if (failed && !token) {
    // 同一次送出答數字題時會再送一次，那次不重複記
    if (!h.challengeToken) await recordFailure(req, failed);
    return false;
  }
  if (!token || token.length > 2048) throw turnstileError('人機驗證還沒完成，請稍等一下再送出。');
  const verdict = await turnstileVerdict(token, ip);
  // Cloudflare 自己掛掉時先放行：報名、借場地不能因為別人的服務停擺就全部卡住
  if (verdict === 'ok' || verdict === 'unreachable') return true;
  throw turnstileError('人機驗證沒有通過，請再送出一次。');
}

// ---------------------------------------------------------------- 把關

/**
 * 送出前檢查一次。沒問題就什麼都不做；可疑就丟 428，
 * 前台重新拿 Turnstile 通行碼（或跳出題目、答完）再送一次。
 *
 * human：前台送來的 { website（陷阱欄位）, turnstile（Turnstile 通行碼）,
 *                     turnstileFailed（Cloudflare 在這個瀏覽器過不了的原因）,
 *                     ticket, challengeToken, answer（備用檢查用） }
 */
export async function checkHuman(kind, req, human = {}) {
  if (!HUMAN_CHECK_ON) return;
  const ip = clientIp(req);
  const h = human && typeof human === 'object' ? human : {};
  // 陷阱欄位有東西＝機器人。不出題、直接擋（出題等於教它怎麼過）
  if (String(h.website || '').trim()) {
    throw Object.assign(new Error('送出失敗，請重新整理頁面再試一次。'), { status: 400, expected: true });
  }
  if (TURNSTILE_ON && await checkTurnstile(req, ip, h)) return;
  // 備用檢查：入場券、次數，可疑才出一題
  const count = await countHit(kind, ip);
  if (h.challengeToken) {
    // 每一題只能答一次（不然機器人可以拿同一題把所有答案試一遍）
    const nonce = String(h.challengeToken).split('.')[1] || '';
    const firstTry = (await countHit('challenge', nonce)) === 1;
    if (firstTry && challengePassed(h.challengeToken, h.answer)) return;
    // 一直答錯的就先擋一陣子
    if (overLimit('wrong', await countHit('wrong', ip))) {
      throw Object.assign(new Error('答錯太多次了，請過 10 分鐘再試。'), { status: 429, expected: true });
    }
    throw Object.assign(new Error('答案不對，再試一次。'), {
      status: 428, expected: true, extra: { challenge: makeChallenge(), wrong: true },
    });
  }
  const problem = ticketProblem(h.ticket, kind);
  if (!problem && !overLimit(kind, count)) return;
  throw Object.assign(new Error('請先回答一個小問題，確認你不是機器人。'), {
    status: 428, expected: true, extra: { challenge: makeChallenge() },
  });
}
