// 把活動同步到 Google 行事曆。
//
// 每一堂課一個事件（9 堂的吉他班就是 9 個），改日期、改時間、改名稱都會跟著更新，
// 活動刪掉事件也一起刪。事件顏色照負責工作人員的代號分。
//
// 為什麼不用 googleapis 套件：這個專案只靠 pg 一個相依套件，
// 服務帳戶的驗證其實就是「自己簽一個 JWT 去換 access token」，
// node:crypto 就做得到，沒必要為了這個拉進一大包相依。
//
// 沒設定環境變數時整個模組就是空轉 —— 本機開發、測試不會去打 Google。

import { createSign } from 'node:crypto';
import { PUBLIC_BASE_URL } from './config.js';

const TOKEN_URL = process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token';
const API_BASE = process.env.GOOGLE_API_BASE || 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TIME_ZONE = 'Asia/Taipei';

const CALENDAR_ID = (process.env.GOOGLE_CALENDAR_ID || '').trim();
const CLIENT_EMAIL = (process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '').trim();

/**
 * 私鑰從環境變數讀回來的幾種樣子都要吃得下去：
 * Vercel 的欄位是單行的，所以換行常常是 `\n` 兩個字；
 * 從 JSON 檔整段複製過來時，頭尾還會多一對引號。
 */
function readPrivateKey() {
  let key = (process.env.GOOGLE_PRIVATE_KEY || '').trim();
  if (key.length > 1 && key[0] === '"' && key[key.length - 1] === '"') key = key.slice(1, -1);
  return key.replace(/\\n/g, '\n').trim();
}
const PRIVATE_KEY = readPrivateKey();

/** 三個都設了才會真的去同步。少一個就當沒開這個功能。 */
export function isConfigured() {
  return Boolean(CALENDAR_ID && CLIENT_EMAIL && PRIVATE_KEY);
}

/** 還缺哪幾個環境變數 —— 後台的「行事曆連線」就是顯示這個。 */
export function missingConfig() {
  const missing = [];
  if (!CALENDAR_ID) missing.push('GOOGLE_CALENDAR_ID');
  if (!CLIENT_EMAIL) missing.push('GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!PRIVATE_KEY) missing.push('GOOGLE_PRIVATE_KEY');
  return missing;
}

/** 目前的設定長什麼樣子。私鑰只回報「有沒有、看起來對不對」，不會回傳內容。 */
export function configSummary() {
  return {
    configured: isConfigured(),
    missing: missingConfig(),
    calendarId: CALENDAR_ID,
    serviceAccountEmail: CLIENT_EMAIL,
    privateKeyLooksValid: PRIVATE_KEY.includes('BEGIN') && PRIVATE_KEY.includes('PRIVATE KEY'),
  };
}

/**
 * 負責工作人員 → 行事曆顏色。
 *
 * Google 的事件顏色只有固定 11 種（colorId 1-11），所以是挑最接近的：
 *   W 黃 / J 藍 / H 紅 / V 綠 / R 橙 / L 磚紅 / ALL 灰 / 兩個人以上 紫
 */
export const STAFF_CODES = ['W', 'H', 'V', 'J', 'R', 'L'];

const COLOR_BY_CODE = {
  W: '5', // Banana 黃
  J: '7', // Peacock 藍
  H: '11', // Tomato 紅
  V: '10', // Basil 綠
  R: '6', // Tangerine 橙
  L: '4', // Flamingo 磚紅
};
const COLOR_ALL = '8'; // Graphite 灰
const COLOR_MANY = '3'; // Grape 紫

/** 'WJ' → 紫、'W' → 黃、'ALL' → 灰、沒填 → 不指定顏色（用日曆預設）。 */
export function colorIdFor(staff) {
  const value = String(staff || '').trim().toUpperCase();
  if (!value) return '';
  if (value === 'ALL') return COLOR_ALL;
  const codes = [...new Set(value.split('').filter((c) => STAFF_CODES.includes(c)))];
  if (!codes.length) return '';
  if (codes.length > 1) return COLOR_MANY;
  return COLOR_BY_CODE[codes[0]] || '';
}

/**
 * 事件標題。
 *
 * 跟園方原本那支「行程指令」機器人一致：指令是
 * 「月/日 時間 代號 行程名稱」，代號只負責決定顏色，
 * 真正進到日曆上的標題就是行程名稱本身。所以這裡也只寫活動名稱，
 * 不另外加代號，兩邊建出來的事件才會長得一樣。
 *
 * 要改成「【W】活動名稱」的話，改這一個函式就好。
 */
export function eventTitle(activity) {
  return activity.title;
}

/** 事件說明：把工作人員在行事曆上會想知道的事寫齊。 */
export function eventDescription(activity, session, sessions = []) {
  const lines = [];
  // 只填開始時間時照原本機器人的講法寫「不確定」，不要假裝知道幾點結束
  let time = '（未定）';
  if (session.startTime) {
    time = session.endTime
      ? `${session.startTime}-${session.endTime}`
      : `${session.startTime}-（結束時間不確定）`;
  }
  lines.push(`時間：${time}`);
  if (activity.location) lines.push(`地點：${activity.location}`);
  if (activity.gatheringPlace) lines.push(`集合地點：${activity.gatheringPlace}`);
  lines.push(`名額：${activity.capacity > 0 ? `${activity.capacity} 人` : '不限'}`);
  lines.push(`負責人：${String(activity.staff || '').trim().toUpperCase() || '（未指定）'}`);

  // 連續性課程標一下這是第幾堂，行事曆上才知道進度
  if (sessions.length > 1) {
    const index = sessions.findIndex((s) => s.id === session.id);
    if (index >= 0) lines.push(`堂次：第 ${index + 1} 堂（共 ${sessions.length} 堂）`);
  }
  if (activity.slug && PUBLIC_BASE_URL) {
    lines.push(`報名連結：${PUBLIC_BASE_URL}/activity/${encodeURIComponent(activity.slug)}`);
  }
  if (activity.summary) lines.push('', activity.summary);
  return lines.join('\n');
}

/** 只填了開始時間的話預設抓一小時，說明欄另外註明結束時間不確定。 */
const DEFAULT_MINUTES = 60;

function addMinutes(time, minutes) {
  const [h, m] = time.split(':').map(Number);
  const total = Math.min(h * 60 + m + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

/** 一堂課 → 一個 Google 行事曆事件。沒填時間就當整天的事件。 */
export function eventPayload(activity, session, sessions = []) {
  const body = {
    summary: eventTitle(activity),
    description: eventDescription(activity, session, sessions),
    location: activity.location || '',
  };
  const color = colorIdFor(activity.staff);
  if (color) body.colorId = color;

  if (session.startTime) {
    const end = session.endTime || addMinutes(session.startTime, DEFAULT_MINUTES);
    body.start = { dateTime: `${session.date}T${session.startTime}:00`, timeZone: TIME_ZONE };
    body.end = { dateTime: `${session.date}T${end}:00`, timeZone: TIME_ZONE };
  } else {
    // 整天事件的結束日期是「隔天」，Google 的規格是右開區間
    const next = new Date(`${session.date}T00:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    body.start = { date: session.date };
    body.end = { date: next.toISOString().slice(0, 10) };
  }
  return body;
}

// ---------------------------------------------------------------- 存取權杖

let cachedToken = { value: '', expiresAt: 0 };

function base64url(input) {
  return Buffer.from(input).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 服務帳戶用自己的私鑰簽一個 JWT，拿去換 access token。 */
async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken.value && cachedToken.expiresAt > now + 60) return cachedToken.value;

  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = base64url(JSON.stringify({
    iss: CLIENT_EMAIL,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600,
  }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claim}`);
  const signature = signer.sign(PRIVATE_KEY).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${header}.${claim}.${signature}`,
    }).toString(),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    throw new Error(`Google 驗證失敗（${res.status}）：${data.error_description || data.error || ''}`);
  }
  cachedToken = { value: data.access_token, expiresAt: now + (Number(data.expires_in) || 3600) };
  return cachedToken.value;
}

async function callApi(path, { method = 'GET', body } = {}) {
  const token = await accessToken();
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return {};
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = data.error?.message || `HTTP ${res.status}`;
    const err = new Error(`Google 行事曆：${message}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

const eventsPath = () => `/calendars/${encodeURIComponent(CALENDAR_ID)}/events`;

export async function createEvent(payload) {
  const data = await callApi(eventsPath(), { method: 'POST', body: payload });
  return data.id || '';
}

export async function updateEvent(eventId, payload) {
  await callApi(`${eventsPath()}/${encodeURIComponent(eventId)}`, { method: 'PATCH', body: payload });
}

export async function deleteEvent(eventId) {
  try {
    await callApi(`${eventsPath()}/${encodeURIComponent(eventId)}`, { method: 'DELETE' });
  } catch (err) {
    // 已經被人在 Google 那邊手動刪掉了：當作成功，不要卡住後續流程
    if (err.status !== 404 && err.status !== 410) throw err;
  }
}

/**
 * 把一個活動的所有場次同步到行事曆。
 *
 * 回傳每一堂對應的事件代號（新建立的才會有值），由呼叫端寫回 sessions。
 * 整段包在 try 裡 —— 行事曆掛掉不該讓工作人員連活動都存不了。
 */
export async function syncActivity(activity, sessions) {
  if (!isConfigured()) return { synced: false, reason: 'not-configured', ids: new Map() };

  const ids = new Map();
  const failed = [];
  for (const session of sessions) {
    const payload = eventPayload(activity, session, sessions);
    try {
      if (session.gcalEventId) {
        try {
          await updateEvent(session.gcalEventId, payload);
        } catch (err) {
          // 有人直接在 Google 那邊把事件刪掉了：重建一個，不要從此就消失
          if (err.status !== 404 && err.status !== 410) throw err;
          const id = await createEvent(payload);
          if (id) ids.set(session.id, id);
        }
      } else {
        const id = await createEvent(payload);
        if (id) ids.set(session.id, id);
      }
    } catch (err) {
      failed.push(`${session.date}：${err.message}`);
    }
  }
  return { synced: failed.length === 0, failed, ids };
}

/**
 * 連線測試：照真正同步會走的路，一步一步試給人看。
 *
 * 「活動存了但日曆沒東西」可能卡在四個地方，錯誤訊息長得都不一樣，
 * 所以這裡分開回報，才知道要去改 Vercel 的環境變數、還是回 Google 日曆按分享。
 * 最後那一步會真的建一個測試事件再刪掉 —— 只有「變更活動」權限才做得到，
 * 分享成唯讀的話這一步就會擋下來。
 */
export async function checkAccess() {
  const steps = [];
  const summary = configSummary();
  if (!summary.configured) {
    steps.push({ name: '環境變數', ok: false, message: `還沒設定：${summary.missing.join('、')}` });
    return { ok: false, steps, ...summary };
  }
  steps.push({
    name: '環境變數',
    ok: summary.privateKeyLooksValid,
    message: summary.privateKeyLooksValid
      ? '三個都設好了'
      : '私鑰看起來不完整，要從 JSON 複製整段（含 BEGIN / END 那兩行）',
  });

  // 1. 換 access token：私鑰不對、服務帳戶被停用都會卡在這裡
  cachedToken = { value: '', expiresAt: 0 };
  try {
    await accessToken();
    steps.push({ name: '服務帳戶登入', ok: true, message: CLIENT_EMAIL });
  } catch (err) {
    steps.push({
      name: '服務帳戶登入',
      ok: false,
      message: `${err.message}。多半是私鑰貼錯或貼不完整，回 Vercel 重貼 GOOGLE_PRIVATE_KEY 再 Redeploy。`,
    });
    return { ok: false, steps, ...summary };
  }

  // 2. 讀得到這本日曆嗎：讀不到通常就是還沒把日曆分享給服務帳戶
  try {
    const cal = await callApi(`/calendars/${encodeURIComponent(CALENDAR_ID)}`);
    steps.push({ name: '找得到日曆', ok: true, message: cal.summary || CALENDAR_ID });
  } catch (err) {
    // Calendar API 沒啟用也是 403，但要去 Cloud Console 按啟用，不是去日曆分享
    const apiOff = /has not been used|disabled|SERVICE_DISABLED/i.test(err.message);
    const notShared = err.status === 404 || err.status === 403;
    let message = err.message;
    if (apiOff) {
      message = 'Google Cloud 專案還沒啟用 Calendar API，到 API 和服務 → 程式庫啟用它。';
    } else if (notShared) {
      message = `找不到這本日曆。可能是日曆 ID 打錯，或是還沒分享 —— `
        + `到 Google 日曆的「設定和共用 → 與特定使用者共用」把 ${CLIENT_EMAIL} 加進去，權限選「變更活動」。`;
    }
    steps.push({ name: '找得到日曆', ok: false, message });
    return { ok: false, steps, ...summary };
  }

  // 3. 寫得進去嗎：分享成唯讀的話，事件永遠建不出來
  let testId = '';
  try {
    const today = new Date();
    const day = (offset) => new Date(today.getTime() + offset * 86400000).toISOString().slice(0, 10);
    testId = await createEvent({
      summary: '（報名系統連線測試，可以直接刪）',
      description: '這是活動報名系統按「測試連線」建的，確認完會自動刪掉。',
      // 整天事件的結束日期是隔天（右開區間），跟開始同一天 Google 會擋下來
      start: { date: day(0) },
      end: { date: day(1) },
    });
    steps.push({ name: '建立事件', ok: true, message: '可以寫進這本日曆' });
  } catch (err) {
    steps.push({
      name: '建立事件',
      ok: false,
      message: err.status === 403
        ? '沒有寫入權限。日曆的分享權限要選「變更活動」，不能只是「查看所有活動詳細資訊」。'
        : err.message,
    });
    return { ok: false, steps, ...summary };
  }
  if (testId) await deleteEvent(testId);

  return { ok: true, steps, ...summary };
}

/** 活動刪掉、或某幾堂被移除時，一起把行事曆上的事件刪掉。 */
export async function removeEvents(sessions) {
  if (!isConfigured()) return { synced: false, reason: 'not-configured' };
  const failed = [];
  for (const session of sessions) {
    if (!session.gcalEventId) continue;
    try {
      await deleteEvent(session.gcalEventId);
    } catch (err) {
      failed.push(`${session.date}：${err.message}`);
    }
  }
  return { synced: failed.length === 0, failed };
}
