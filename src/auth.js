import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ADMIN_PASSWORD, SESSION_SECRET, SESSION_TTL_MS, SESSION_COOKIE,
} from './config.js';
import { parseCookies, setCookie, clientIp } from './http.js';
import { toHalfWidth } from './util.js';

/** 定時安全的字串比對，避免用回應時間猜密碼。 */
function safeEqual(a, b) {
  const bufA = Buffer.from(String(a), 'utf8');
  const bufB = Buffer.from(String(b), 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function sign(payload) {
  return createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
}

function issueToken() {
  const expiresAt = Date.now() + SESSION_TTL_MS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

/** 驗證 cookie 內的權杖是否有效且未過期。 */
export function isAuthenticated(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return false;
  const idx = token.lastIndexOf('.');
  if (idx === -1) return false;
  const payload = token.slice(0, idx);
  const signature = token.slice(idx + 1);
  if (!safeEqual(signature, sign(payload))) return false;
  return Number(payload) > Date.now();
}

// ---- 登入嘗試次數限制（記憶體內，重啟即清空）----
const attempts = new Map();
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

function recordFailure(ip) {
  const now = Date.now();
  const entry = attempts.get(ip) || { count: 0, firstAt: now };
  if (now - entry.firstAt > WINDOW_MS) {
    entry.count = 0;
    entry.firstAt = now;
  }
  entry.count += 1;
  attempts.set(ip, entry);
}

export function isLockedOut(ip) {
  const entry = attempts.get(ip);
  if (!entry) return false;
  if (Date.now() - entry.firstAt > WINDOW_MS) {
    attempts.delete(ip);
    return false;
  }
  return entry.count >= MAX_ATTEMPTS;
}

/**
 * 嘗試登入。密碼正確就發權杖並寫入 cookie。
 * 使用者可能用全形數字輸入密碼，這裡先轉半形再比對。
 */
export function login(req, res, rawPassword) {
  const ip = clientIp(req);
  if (isLockedOut(ip)) {
    return { ok: false, status: 429, message: '嘗試次數過多，請 15 分鐘後再試。' };
  }
  const password = toHalfWidth(String(rawPassword || '')).trim();
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    recordFailure(ip);
    return { ok: false, status: 401, message: '密碼錯誤。' };
  }
  attempts.delete(ip);
  setCookie(res, SESSION_COOKIE, issueToken(), {
    maxAge: SESSION_TTL_MS,
    secure: (req.headers['x-forwarded-proto'] || '') === 'https',
  });
  return { ok: true };
}

export function logout(res) {
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
}
