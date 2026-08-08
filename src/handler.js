import { ensureSchema } from './db.js';
import { seedIfEmpty } from './seed.js';
import { handleApi } from './api.js';
import { sendJson } from './http.js';

let bootstrapped = null;

/**
 * 建表 + 首次啟動放範例活動。
 * serverless 每個新實例會跑一次，之後同一個實例就直接沿用。
 */
export function bootstrap() {
  if (!bootstrapped) {
    bootstrapped = ensureSchema()
      .then(() => seedIfEmpty())
      .catch((err) => {
        bootstrapped = null; // 失敗讓下一次請求重試，不要永久卡死
        throw err;
      });
  }
  return bootstrapped;
}

/** 把資料庫的錯誤翻成看得懂的中文。 */
function describeError(err) {
  if (err.code === '23505') {           // unique_violation
    return { status: 409, message: '這筆資料已經存在了（可能是重複報名或重複的身分證字號）。' };
  }
  if (err.code === '23503') {           // foreign_key_violation
    return { status: 400, message: '找不到對應的活動或學生資料。' };
  }
  if (err.code === 'ECONNREFUSED' || err.code === 'ENOTFOUND') {
    return { status: 503, message: '連不上資料庫，請確認 DATABASE_URL 設定是否正確。' };
  }
  if (/DATABASE_URL/.test(err.message || '')) {
    return { status: 503, message: err.message };
  }
  return { status: err.status || 500, message: err.message || '伺服器發生錯誤' };
}

/**
 * 處理 /api/* 請求，本機伺服器與 Vercel 共用這一段。
 */
export async function handleApiRequest(req, res, url) {
  try {
    await bootstrap();
    const handled = await handleApi(req, res, url);
    if (handled === false) sendJson(res, 404, { error: '找不到這個 API。' });
  } catch (err) {
    const { status, message } = describeError(err);
    if (!err.expected && status >= 500) console.error('[error]', err);
    if (res.headersSent) return res.end();
    sendJson(res, status, { error: message });
  }
}

/** 所有回應都套用的安全標頭。 */
export function applySecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
    + "script-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
  );
}
