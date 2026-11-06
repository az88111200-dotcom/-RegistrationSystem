/**
 * 自己的短網址：https://（正式網址）/s/k7m2 → 轉到 /activity/2026-11-21 這種長的網址。
 *
 * 以前試過丟給 TinyURL 換短網址，結果換出來的連結點了進不去
 * （vercel.app 的網址常被縮網址服務當成可疑連結擋掉）。改成自己做：
 * 短網址就在自己的網站上，不靠別人的服務，也不會被擋。
 *
 * - 同一個網址只配一個代號，記在資料庫（short_paths），之後複製都是同一個短網址。
 * - 代號 4 個字，去掉容易看錯的字（0/o、1/l/i），手打也不會錯。
 * - 只收本站的路徑，不會變成任何人都能用的縮網址服務。
 * - 網域要更短的話：Vercel 加一個短網域（例如 peiliyuan.vercel.app），
 *   設 SHORT_BASE_URL（只換短網址）或 PUBLIC_BASE_URL（全部連結都換）。
 *
 * 有設定 PicSee（PICSEE_API_TOKEN）的話，複製出來的是 PicSee 的短網址（pse.is/…），
 * 直接指到報名頁的正式網址。每個網址只換一次、記在資料庫（免費帳號一年 800 個）；
 * PicSee 連不上、額度用完或回傳怪怪的時候，就改給自己的 /s/代號，不會卡住。
 *
 * SHORT_LINKS=0 可以關掉（複製就給原本的長網址）。
 * PICSEE_API_URL 只有本機測試會用（假的 PicSee）。
 */

import { randomInt } from 'node:crypto';
import { query } from './db.js';
import { PUBLIC_BASE_URL } from './config.js';

const SHORT_LINKS_ON = String(process.env.SHORT_LINKS ?? '1').trim() !== '0';
const SHORT_BASE_URL = String(process.env.SHORT_BASE_URL || '').trim().replace(/\/+$/, '');
const PICSEE_API_TOKEN = String(process.env.PICSEE_API_TOKEN || '').trim();
const PICSEE_API_URL = process.env.PICSEE_API_URL || 'https://api.pics.ee/v1/links';
/*
 * 要用 PicSee 的哪個網域。預設 pse.is（最短）；不設的話 PicSee 會用帳號的子網域
 * （userXXXX.pse.is，比較長）。PicSee 不收這個網域時，自動退回帳號預設的。
 * 有自己的品牌短網域的話設 PICSEE_DOMAIN；設成 0 就不指定。
 */
const PICSEE_DOMAIN = (() => {
  const v = String(process.env.PICSEE_DOMAIN ?? 'pse.is').trim();
  return v === '0' ? '' : v;
})();
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
const CODE_RE = /^[a-z0-9]{3,12}$/;

const newCode = (length = 4) => Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');

function checkPath(path) {
  const p = String(path || '');
  if (!p.startsWith('/') || p.startsWith('//') || /\s/.test(p) || p.length > 500 || p.startsWith('/s/')) {
    throw Object.assign(new Error('連結格式不對。'), { status: 400, expected: true });
  }
  return p;
}

/** 這個路徑的代號，沒有就配一個新的。 */
async function codeFor(path) {
  const { rows } = await query('SELECT code FROM short_paths WHERE path = $1', [path]);
  if (rows[0]) return rows[0].code;
  for (let i = 0; i < 8; i += 1) {
    // 撞到別人的代號（機率很低）就換一個；撞到同一個路徑（兩個人同時按）就用對方配好的
    const code = newCode(i < 5 ? 4 : 5);
    const { rows: made } = await query(
      `INSERT INTO short_paths (code, path, created_at) VALUES ($1, $2, now()::text)
       ON CONFLICT DO NOTHING RETURNING code`,
      [code, path],
    );
    if (made[0]) return made[0].code;
    const { rows: again } = await query('SELECT code FROM short_paths WHERE path = $1', [path]);
    if (again[0]) return again[0].code;
  }
  throw new Error('短網址代號一直撞到，請再試一次。');
}

/** 本機、內網的網址丟給 PicSee 也沒用（外面的人連不到） */
function isLocalBase(base) {
  try {
    const { hostname } = new URL(base);
    return hostname === 'localhost' || hostname.endsWith('.local')
      || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[?::1\]?$)/.test(hostname);
  } catch {
    return true;
  }
}

/** 請 PicSee 把長網址換成短網址。失敗就丟錯（外面會改用自己的 /s/代號）。 */
async function askPicsee(longUrl) {
  if (PICSEE_DOMAIN) {
    try {
      return await askPicseeWith({ url: longUrl, domain: PICSEE_DOMAIN });
    } catch (err) {
      // 這個網域不給用（例如方案不支援）：不指定網域再試一次，用帳號預設的
      console.warn(`[shortlink] PicSee 不收網域 ${PICSEE_DOMAIN}，改用帳號預設的`, err.message);
    }
  }
  return askPicseeWith({ url: longUrl });
}

async function askPicseeWith(payload) {
  const res = await fetch(`${PICSEE_API_URL}?access_token=${encodeURIComponent(PICSEE_API_TOKEN)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(6000),
  });
  const data = await res.json().catch(() => ({}));
  const raw = String(data?.data?.picseeUrl || data?.picseeUrl || '').trim();
  const url = raw.replace(/^http:\/\//, 'https://');
  if (!res.ok || !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/[A-Za-z0-9_-]{2,40}$/.test(url)) {
    throw new Error(`PicSee 回傳 ${res.status}：${JSON.stringify(data).slice(0, 120)}`);
  }
  return url;
}

/** 這個路徑的 PicSee 短網址：換過就用記住的，沒換過才請 PicSee 換（失敗回 ''） */
async function picseeFor(path, longUrl) {
  const { rows } = await query('SELECT picsee_url, picsee_target FROM short_paths WHERE path = $1', [path]);
  // 正式網址或要用的 PicSee 網域換過，就要重換（不然會指到舊的地方、或還是舊的長網域）
  const target = `${longUrl}#${PICSEE_DOMAIN}`;
  if (rows[0]?.picsee_url && rows[0].picsee_target === target) return rows[0].picsee_url;
  try {
    const url = await askPicsee(longUrl);
    await query('UPDATE short_paths SET picsee_url = $2, picsee_target = $3 WHERE path = $1', [path, url, target]);
    return url;
  } catch (err) {
    console.warn('[shortlink] PicSee 換不到，改用自己的短網址', err.message);
    return '';
  }
}

/**
 * path：本站的路徑，例如 /activity/2026-11-14。
 * fallbackOrigin：沒有設定正式網址時（本機開發）用的網址開頭。
 * 回傳 { url, longUrl, short }：short=false 代表短網址關掉了，url 就是長網址。
 */
export async function shortLinkFor(path, fallbackOrigin) {
  const p = checkPath(path);
  const longUrl = `${PUBLIC_BASE_URL || fallbackOrigin}${p}`;
  if (!SHORT_LINKS_ON) return { url: longUrl, longUrl, short: false };
  const base = SHORT_BASE_URL || PUBLIC_BASE_URL || fallbackOrigin;
  // 自己的代號一定先配好：PicSee 有問題時用它，也拿來記 PicSee 換到的網址
  const own = `${base}/s/${await codeFor(p)}`;
  if (PICSEE_API_TOKEN && !isLocalBase(longUrl)) {
    const picsee = await picseeFor(p, longUrl);
    if (picsee) return { url: picsee, longUrl, short: true, via: 'picsee' };
  }
  return { url: own, longUrl, short: true, via: 'own' };
}

/** /s/代號 要轉去哪裡（找不到回 null）。 */
export async function resolveShortCode(code) {
  const c = String(code || '').toLowerCase();
  if (!CODE_RE.test(c)) return null;
  const { rows } = await query('SELECT path FROM short_paths WHERE code = $1', [c]);
  return rows[0]?.path || null;
}
