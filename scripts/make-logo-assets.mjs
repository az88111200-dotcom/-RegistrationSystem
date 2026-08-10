/*
 * 從完整的識別標誌 public/assets/logo.png 產生兩個小檔：
 *
 *   logo-mark.png  頁首用的小標誌（只取上面那台飛機，去背）
 *   favicon.png    瀏覽器分頁的小圖示
 *
 * 為什麼要另外產：原始標誌是 2363×2363、將近 2MB 的正方形圖，
 * 頁首只顯示 54×36，直接載原圖等於讓每個少年的手機多吃 2MB 流量。
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

// 飛機在原圖裡的位置（用 OpenCV 量出來的比例）
const PLANE = {
  left: 0.0135, top: 0.0690, width: 0.9657, height: 0.6416,
  // 頁首用的裁切值，由上面的比例換算：100/width、100/height、left/(1-width)…
  size: '103.5% 155.9%', position: '39.5% 19.2%', ratio: 1.5,
};

const browser = await chromium.launch();

/**
 * 把原圖裁切成「只有飛機」的一塊，再截圖存成小檔。
 *
 * 裁切的框一定要剛好等於飛機的長寬比。框如果比飛機高，
 * 多出來的地方就會露出飛機下面的字標 —— 只調位置是蓋不掉的，
 * 一定要讓框本身框住飛機。需要正方形圖示時，
 * 再把這個框放進一個白底的正方形裡置中。
 */
async function crop({ file, planeWidth, box, background }) {
  const w = Math.round(planeWidth);
  const h = Math.round(planeWidth / PLANE.ratio);
  const outer = box || { width: w, height: h };

  const page = await browser.newPage({
    viewport: { width: outer.width, height: outer.height },
    deviceScaleFactor: 1,
  });
  await page.setContent(
    `<body style="margin:0">
       <div id="mark" style="
         width:${outer.width}px;height:${outer.height}px;
         display:grid;place-items:center;
         ${background ? `background:${background};` : ''}
       ">
         <div style="
           width:${w}px;height:${h}px;
           background-image:url('${SOURCE}');
           background-repeat:no-repeat;
           background-size:${PLANE.size};
           background-position:${PLANE.position};
         "></div>
       </div>
     </body>`,
  );
  await page.locator('#mark').screenshot({
    path: path.join(ASSETS, file),
    omitBackground: !background,
  });
  await page.close();
  console.log(`  ${file}  ${outer.width}×${outer.height}`);
}

console.log('產生標誌小檔：');

// 頁首用：54×36 顯示，存 3 倍大小讓高解析螢幕也清楚
await crop({ file: 'logo-mark.png', planeWidth: 162 });

// 分頁圖示：白底正方形，飛機置中、四周留一點白邊
await crop({
  file: 'favicon.png',
  planeWidth: 64 * 0.92,
  box: { width: 64, height: 64 },
  background: '#ffffff',
});

await browser.close();
console.log('完成。');
