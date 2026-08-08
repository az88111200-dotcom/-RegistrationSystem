import http from 'node:http';
import { PORT, PUBLIC_DIR } from './src/config.js';
import { serveStatic, sendJson, sendText } from './src/http.js';
import { handleApi } from './src/api.js';
import { getDb } from './src/store.js';
import { findActivity } from './src/model.js';

/**
 * 好記的網址對應到實際的頁面檔案。
 * 每個活動都有自己的子頁面：/activity/<slug>
 */
function resolvePage(pathname) {
  if (pathname === '/' || pathname === '/index.html') return '/index.html';
  if (pathname === '/past' || pathname === '/past-activities') return '/past.html';
  if (pathname === '/admin' || pathname === '/admin/') return '/admin/index.html';
  if (pathname === '/admin/students') return '/admin/students.html';

  // /admin/activity/<id> → 後台單一活動名冊頁
  if (/^\/admin\/activity\/[^/]+\/?$/.test(pathname)) return '/admin/activity.html';

  // /activity/<slug> → 前台單一活動報名頁（先確認活動存在）
  const m = /^\/activity\/([^/]+)\/?$/.exec(pathname);
  if (m) return findActivity(decodeURIComponent(m[1])) ? '/activity.html' : null;

  return pathname;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // 基本安全標頭。CSP 只允許同源資源，前端沒有用到任何外部 CDN。
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
    + "script-src 'self'; form-action 'self'; base-uri 'self'; frame-ancestors 'none'",
  );

  try {
    if (url.pathname.startsWith('/api/')) {
      const handled = await handleApi(req, res, url);
      if (handled === false) sendJson(res, 404, { error: '找不到這個 API。' });
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return sendText(res, 405, 'Method Not Allowed');
    }

    const page = resolvePage(url.pathname);
    if (page && serveStatic(req, res, page)) return;

    // 找不到頁面時回首頁的 404 畫面
    if (serveStatic(req, res, '/404.html')) {
      res.statusCode = 404;
      return;
    }
    sendText(res, 404, '找不到頁面');
  } catch (err) {
    const status = err.status || 500;
    if (!err.expected && status >= 500) console.error('[error]', err);
    if (res.headersSent) return res.end();
    sendJson(res, status, { error: err.message || '伺服器發生錯誤' });
  }
});

// 啟動時先把資料檔載入，資料有問題要馬上知道，而不是等第一個人報名才爆掉。
getDb();

server.listen(PORT, () => {
  console.log(`
  少年培力園 活動報名系統已啟動

    報名首頁   http://localhost:${PORT}/
    工作人員後台 http://localhost:${PORT}/admin

  靜態檔目錄：${PUBLIC_DIR}
`);
});
