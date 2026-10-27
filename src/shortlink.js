/**
 * 複製連結時自動換成 TinyURL 短網址。
 *
 * 報名、簽到、前後測的網址一大串（Vercel 給的網域很長），貼到 LINE 很難看。
 * 後台按「複製連結」時，這裡把網址丟給 TinyURL 換成 https://tinyurl.com/xxxx。
 *
 * - 同一個網址只換一次，換過的記在資料庫（short_links），之後複製都是同一個短網址。
 * - 一律用正式網址去換（PUBLIC_BASE_URL），不管工作人員從哪個網址開後台。
 * - TinyURL 連不上或回傳怪怪的時候，就給原本的長網址，不會卡住。
 * - 只換本站的網址（只收路徑），不會變成任何人都能用的縮網址服務。
 *
 * 預設關閉，SHORT_LINKS=1 才打開；TINYURL_API_URL 只有本機測試會用（假的 TinyURL）。
 */

import { query } from './db.js';
import { PUBLIC_BASE_URL } from './config.js';

// 目前停用：TinyURL 換出來的短網址點了進不去（vercel.app 的網址常被縮網址服務擋），
// 先複製原本的正式網址。要再試的話在 Vercel 環境變數設 SHORT_LINKS=1。
const SHORT_LINKS_ON = String(process.env.SHORT_LINKS ?? '0').trim() === '1';
const TINYURL_API_URL = process.env.TINYURL_API_URL || 'https://tinyurl.com/api-create.php';
const TINYURL_PATTERN = /^https:\/\/tinyurl\.com\/[A-Za-z0-9_-]{3,60}$/;

/** 本機、內網的網址換了也沒用（外面的人連不到） */
function isLocalBase(base) {
  try {
    const { hostname } = new URL(base);
    return hostname === 'localhost' || hostname.endsWith('.local')
      || /^(127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.0\.0\.0$|\[?::1\]?$)/.test(hostname);
  } catch {
    return true;
  }
}

async function askTinyUrl(longUrl) {
  const res = await fetch(`${TINYURL_API_URL}?url=${encodeURIComponent(longUrl)}`, {
    signal: AbortSignal.timeout(6000),
  });
  const text = (await res.text()).trim();
  if (!res.ok || !TINYURL_PATTERN.test(text)) throw new Error(`TinyURL 回傳 ${res.status}：${text.slice(0, 80)}`);
  return text;
}

/**
 * path：本站的路徑，例如 /activity/2026-11-14。
 * fallbackOrigin：沒有設定正式網址時（本機開發）用的網址開頭。
 * 回傳 { url, short }：short=false 代表給的是原本的長網址。
 */
export async function shortLinkFor(path, fallbackOrigin) {
  const p = String(path || '');
  if (!p.startsWith('/') || p.startsWith('//') || /\s/.test(p) || p.length > 500) {
    throw Object.assign(new Error('連結格式不對。'), { status: 400, expected: true });
  }
  const base = PUBLIC_BASE_URL || fallbackOrigin;
  const longUrl = `${base}${p}`;
  if (!SHORT_LINKS_ON || isLocalBase(base)) return { url: longUrl, short: false };

  const { rows } = await query('SELECT short_url FROM short_links WHERE long_url = $1', [longUrl]);
  if (rows[0]) return { url: rows[0].short_url, short: true };
  try {
    const shortUrl = await askTinyUrl(longUrl);
    await query(
      `INSERT INTO short_links (long_url, short_url, created_at) VALUES ($1, $2, now()::text)
       ON CONFLICT (long_url) DO NOTHING`,
      [longUrl, shortUrl],
    );
    return { url: shortUrl, short: true };
  } catch (err) {
    console.warn('[shortlink] 換短網址失敗，改給長網址', err.message);
    return { url: longUrl, short: false };
  }
}
