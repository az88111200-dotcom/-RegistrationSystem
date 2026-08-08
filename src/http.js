import fs from 'node:fs';
import path from 'node:path';
import { PUBLIC_DIR } from './config.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const MAX_BODY_BYTES = 1024 * 1024; // 1MB，報名表單遠遠用不到這麼多

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function sendText(res, status, text, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(text);
}

/**
 * RFC 5987 的 ext-value 編碼。
 * encodeURIComponent 不會編 ' ( ) * !，但這些字元在 ext-value 裡不合法，
 * 活動名稱有括號時會讓整個標頭失效，所以補上。
 */
function encodeRfc5987(value) {
  return encodeURIComponent(value)
    .replace(/['()*!]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * 送出 CSV 下載。
 *
 * - 開頭加 BOM，Excel 打開中文才不會變亂碼。
 * - filename* 帶中文原名，支援的瀏覽器會用它。
 * - filename 是純 ASCII 備援；有些瀏覽器不收非 ASCII 檔名，
 *   這時備援名要能分辨是哪個活動，不能是千篇一律的 export.csv。
 */
export function sendCsv(res, filename, asciiFallback, csv) {
  const body = Buffer.concat([Buffer.from('﻿', 'utf8'), Buffer.from(csv, 'utf8')]);
  const safeAscii = String(asciiFallback || 'export.csv')
    .replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'export.csv';
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Length': body.length,
    'Content-Disposition':
      `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeRfc5987(filename)}`,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** 讀取並解析 JSON request body。 */
export function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('資料量過大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('資料格式錯誤'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

export function setCookie(res, name, value, { maxAge, secure } = {}) {
  const bits = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
  ];
  if (maxAge !== undefined) bits.push(`Max-Age=${Math.floor(maxAge / 1000)}`);
  if (secure) bits.push('Secure');
  const existing = res.getHeader('Set-Cookie');
  const list = existing ? [].concat(existing) : [];
  list.push(bits.join('; '));
  res.setHeader('Set-Cookie', list);
}

/** 取得請求端 IP，用於登入次數限制。 */
export function clientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/**
 * 提供 public/ 底下的靜態檔。回傳 true 代表已處理。
 * 只允許 PUBLIC_DIR 內的檔案，防止路徑穿越。
 */
export function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel.endsWith('/')) rel += 'index.html';
  if (!path.extname(rel)) rel += '.html';

  const target = path.join(PUBLIC_DIR, rel);
  if (!target.startsWith(PUBLIC_DIR + path.sep)) return false;

  let stat;
  try {
    stat = fs.statSync(target);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(target).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    // HTML 不快取，才不會改完看到舊畫面；靜態資源短快取即可。
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  fs.createReadStream(target).pipe(res);
  return true;
}
