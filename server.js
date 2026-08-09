// 本機／自架伺服器的進入點。
// 部署到 Vercel 時走的是 api/[...path].js，不會用到這個檔案。

import http from 'node:http';
import { PORT, PUBLIC_DIR } from './src/config.js';
import { serveStatic, sendText } from './src/http.js';
import { handleApiRequest, applySecurityHeaders, bootstrap } from './src/handler.js';
import { findActivity } from './src/model.js';

/**
 * 好記的網址對應到實際的頁面檔案。
 * 每個活動都有自己的子頁面：/activity/<slug>
 * （部署到 Vercel 時，這份對應寫在 vercel.json 的 rewrites 裡。）
 */
async function resolvePage(pathname) {
  if (pathname === '/' || pathname === '/index.html') return '/index.html';
  if (pathname === '/past' || pathname === '/past-activities') return '/past.html';
  if (pathname === '/checkin') return '/checkin.html';
  if (pathname === '/admin' || pathname === '/admin/') return '/admin/index.html';
  if (pathname === '/admin/checkin') return '/admin/checkin.html';
  if (pathname === '/admin/students') return '/admin/students.html';
  if (pathname === '/admin/reports') return '/admin/reports.html';
  if (/^\/admin\/activity\/[^/]+\/?$/.test(pathname)) return '/admin/activity.html';

  const m = /^\/activity\/([^/]+)\/?$/.exec(pathname);
  if (m) return await findActivity(decodeURIComponent(m[1])) ? '/activity.html' : null;

  return pathname;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  applySecurityHeaders(res);

  if (url.pathname.startsWith('/api/')) {
    return handleApiRequest(req, res, url);
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendText(res, 405, 'Method Not Allowed');
  }

  try {
    const page = await resolvePage(url.pathname);
    if (page && serveStatic(req, res, page)) return;
  } catch (err) {
    console.error('[error]', err);
    return sendText(res, 500, '伺服器發生錯誤');
  }

  if (serveStatic(req, res, '/404.html')) {
    res.statusCode = 404;
    return;
  }
  sendText(res, 404, '找不到頁面');
});

// 啟動時就把資料表建好，設定有問題要馬上知道，而不是等第一個人報名才爆掉。
try {
  await bootstrap();
} catch (err) {
  console.error(`\n  無法連線資料庫：\n  ${err.message}\n`);
  process.exit(1);
}

server.listen(PORT, () => {
  console.log(`
  少年培力園 活動報名系統已啟動

    報名首頁     http://localhost:${PORT}/
    工作人員後台 http://localhost:${PORT}/admin

  靜態檔目錄：${PUBLIC_DIR}
`);
});
