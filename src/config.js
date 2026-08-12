import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

export const PORT = Number(process.env.PORT || 3000);

/**
 * 後台密碼。預設是使用者指定的 81599196。
 * 正式上線請用環境變數 ADMIN_PASSWORD 覆蓋，不要把密碼留在程式碼裡
 * ——這個 repo 是公開的，看得到原始碼就等於知道預設密碼。
 */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '81599196';

/** 登入權杖有效期限：12 小時。 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'pl_admin';

/**
 * 簽章用的密鑰。
 *
 * Vercel 的檔案系統是唯讀的，不能像以前那樣把密鑰寫成檔案，
 * 所以一定要用環境變數。沒設定時退而求其次從密碼推導，
 * 這樣至少功能能動，但任何人猜到密碼就能自己偽造權杖，
 * 正式上線務必設定 SESSION_SECRET。
 */
export const SESSION_SECRET = process.env.SESSION_SECRET
  || createHash('sha256').update(`peiliyuan:${ADMIN_PASSWORD}`).digest('hex');

export const HAS_EXPLICIT_SECRET = Boolean(process.env.SESSION_SECRET);

/** 是否跑在 Vercel 上（用來決定 cookie 要不要加 Secure）。 */
export const IS_SERVERLESS = Boolean(process.env.VERCEL);

/**
 * 少年掃 QR 之後要連到的正式網址。
 *
 * 這件事一定要由後端決定，不能用「工作人員當下開後台的網址」——
 * Vercel 會給同一個網站好幾組網址，只有正式網址是公開的，
 * 預覽網址（-git-… 或一串亂碼）會先要求登入 Vercel。
 * 如果工作人員剛好從預覽網址開後台，印出來的 QR 就會永遠指向
 * 那個要登入的網址，少年在現場怎麼掃都掃不進來。
 *
 * VERCEL_PROJECT_PRODUCTION_URL 是 Vercel 自動注入的正式網域，
 * 不管從哪一個網址開後台，這個值都一樣。
 * 之後若改用自訂網域（例如 baoming.peiliyuan.org.tw），
 * 設定 PUBLIC_BASE_URL 環境變數就會蓋過它。
 */
function resolvePublicBaseUrl() {
  const explicit = (process.env.PUBLIC_BASE_URL || '').trim();
  if (explicit) return explicit.replace(/\/+$/, '');
  const vercel = (process.env.VERCEL_PROJECT_PRODUCTION_URL || '').trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;
  return '';   // 本機開發：交給前端用當下的網址
}

export const PUBLIC_BASE_URL = resolvePublicBaseUrl();

