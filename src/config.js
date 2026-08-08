import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
export const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');
export const DB_FILE = path.join(DATA_DIR, 'db.json');
export const BACKUP_DIR = path.join(DATA_DIR, 'backups');

export const PORT = Number(process.env.PORT || 3000);

/**
 * 後台密碼。預設是使用者指定的 81599196。
 * 正式上線建議改用環境變數 ADMIN_PASSWORD 覆蓋，不要把密碼放在程式碼裡。
 */
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '81599196';

/** 登入權杖有效期限：12 小時。 */
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

export const SESSION_COOKIE = 'pl_admin';

/**
 * 簽章用的密鑰。優先使用環境變數，否則在 data/ 產生一份並沿用，
 * 這樣重啟伺服器不會把已登入的工作人員踢出去。
 */
function loadSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'secret.key');
  try {
    const existing = fs.readFileSync(file, 'utf8').trim();
    if (existing) return existing;
  } catch { /* 首次啟動，往下產生 */ }
  const secret = randomBytes(32).toString('hex');
  fs.writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export const SESSION_SECRET = loadSecret();
