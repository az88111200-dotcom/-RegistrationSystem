// Vercel serverless function：處理所有 /api/* 請求。
// 靜態頁面（public/ 底下的 HTML、CSS、JS）由 Vercel 的 CDN 直接送，不經過這裡。

import { handleApiRequest, applySecurityHeaders } from '../src/handler.js';

export default async function handler(req, res) {
  applySecurityHeaders(res);
  const url = new URL(req.url, `https://${req.headers.host || 'localhost'}`);
  await handleApiRequest(req, res, url);
}
