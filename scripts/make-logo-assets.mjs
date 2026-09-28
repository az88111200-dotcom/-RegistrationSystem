/*
 * 從培力園的橫式標誌 public/assets/logo.png 產生網站用的檔：
 *
 *   logo-banner.webp／.png  頁首的整條標誌（前後台共用，縮到頁首需要的大小）
 *   favicon.png             瀏覽器分頁的小圖示（只取左邊那台飛機）
 *
 * 為什麼要另外產：原圖是 1048×177 的去背 PNG，頁首只顯示約 380 寬，
 * 分頁圖示更只要那台飛機 —— 直接載原圖，每個少年的手機都在白吃流量。
 *
 * 換了新的標誌檔之後重跑一次：
 *   node scripts/make-logo-assets.mjs
 * 需要 Playwright（開發環境才有，正式站不需要）。
 */

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = path.join(ROOT, 'public', 'assets');
// 直接把原圖轉成 data URI 塞進頁面 —— 用 file:// 的話，
// 從 about:blank 建出來的頁面載不到本機檔案，會截出一張白圖。
const SOURCE = `data:image/png;base64,${fs.readFileSync(path.join(ASSETS, 'logo.png')).toString('base64')}`;

/*
 * 飛機在原圖裡的位置（原圖 1048×177，逐欄數過不透明像素量出來的）。
 * 飛機尾巴到「新」字的紫色光暈之間，第 216–224 欄幾乎是空的，從 218 切開。
 */
const SRC = { width: 1048, height: 177 };
const PLANE = { x: 0, y: 22, width: 218, height: 146 };

const browser = await chromium.launch();

/**
 * 把原圖的一塊（region）畫到 outW×outH 的畫布上（等比例、置中），存成 PNG。
 * 用 canvas 縮圖，瀏覽器的縮圖演算法比直接截 CSS 縮放的結果乾淨。
 */
async function render({ file, region, outW, outH, background, pad = 0, type = 'image/png' }) {
  const page = await browser.newPage();
  const data = await page.evaluate(async ({ src, region, outW, outH, background, pad, type }) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    if (background) {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, outW, outH);
    }
    const scale = Math.min((outW - pad * 2) / region.width, (outH - pad * 2) / region.height);
    const w = region.width * scale;
    const h = region.height * scale;
    ctx.drawImage(img, region.x, region.y, region.width, region.height,
      (outW - w) / 2, (outH - h) / 2, w, h);
    return canvas.toDataURL(type, 0.9);
  }, { src: SOURCE, region, outW, outH, background, pad, type });
  fs.writeFileSync(path.join(ASSETS, file), Buffer.from(data.split(',')[1], 'base64'));
  const kb = (fs.statSync(path.join(ASSETS, file)).size / 1024).toFixed(1);
  console.log(`  ${file}  ${outW}×${outH}  ${kb} KB`);
  await page.close();
}

console.log('產生標誌檔：');

// 頁首：桌機顯示高 64px（約 380 寬），存 2 倍讓高解析螢幕也清楚。
// 主要給 WebP（小很多，少年多半用手機流量），PNG 留給不支援 WebP 的舊瀏覽器
const bannerH = 128;
const banner = {
  region: { x: 0, y: 0, ...SRC },
  outW: Math.round((SRC.width / SRC.height) * bannerH),
  outH: bannerH,
};
await render({ file: 'logo-banner.webp', type: 'image/webp', ...banner });
await render({ file: 'logo-banner.png', ...banner });

// 分頁圖示：白底正方形，飛機置中、四周留一點白邊
await render({
  file: 'favicon.png', region: PLANE, outW: 64, outH: 64, background: '#ffffff', pad: 3,
});

await browser.close();
console.log('完成。');
