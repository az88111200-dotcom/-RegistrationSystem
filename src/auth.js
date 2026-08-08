import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  ADMIN_PASSWORD, SESSION_SECRET, SESSION_TTL_MS, SESSION_COOKIE, IS_SERVERLESS,
} from './config.js';
import { parseCookies, setCookie, clientIp } from './http.js';
import { toHalfWidth } from './util.js';
import { recordLoginFailure, loginFailureCount, clearLoginFailures } from './repo.js';

const MAX_ATTEMPTS = 10;

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

/**
 * 嘗試登入。密碼正確就發權杖並寫入 cookie。
 *
 * 輸錯次數記在資料庫而不是記憶體：serverless 每次請求可能落在不同的
 * 執行實例上，記憶體計數擋不住有心人反覆猜密碼。
 */
export async function login(req, res, rawPassword) {
  const ip = clientIp(req);

  if (await loginFailureCount(ip) >= MAX_ATTEMPTS) {
    return { ok: false, status: 429, message: '嘗試次數過多，請 15 分鐘後再試。' };
  }

  // 使用者可能用全形數字輸入密碼，先轉半形再比對
  const password = toHalfWidth(String(rawPassword || '')).trim();
  if (!safeEqual(password, ADMIN_PASSWORD)) {
    await recordLoginFailure(ip);
    return { ok: false, status: 401, message: '密碼錯誤。' };
  }

  await clearLoginFailures(ip);
  setCookie(res, SESSION_COOKIE, issueToken(), {
    maxAge: SESSION_TTL_MS,
    secure: IS_SERVERLESS || (req.headers['x-forwarded-proto'] || '') === 'https',
  });
  return { ok: true };
}

export function logout(res) {
  setCookie(res, SESSION_COOKIE, '', { maxAge: 0 });
}
