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
 * SHORT_LINKS=0 可以關掉（複製就給原本的長網址）。
 */

import { randomInt } from 'node:crypto';
import { query } from './db.js';
import { PUBLIC_BASE_URL } from './config.js';

const SHORT_LINKS_ON = String(process.env.SHORT_LINKS ?? '1').trim() !== '0';
const SHORT_BASE_URL = String(process.env.SHORT_BASE_URL || '').trim().replace(/\/+$/, '');
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
  return { url: `${base}/s/${await codeFor(p)}`, longUrl, short: true };
}

/** /s/代號 要轉去哪裡（找不到回 null）。 */
export async function resolveShortCode(code) {
  const c = String(code || '').toLowerCase();
  if (!CODE_RE.test(c)) return null;
  const { rows } = await query('SELECT path FROM short_paths WHERE code = $1', [c]);
  return rows[0]?.path || null;
}
