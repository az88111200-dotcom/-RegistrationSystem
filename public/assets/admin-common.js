// 後台共用：登入閘門、頁首、確認對話框。

import {
  api, apiHuman, honeypot, $, el, showNotice,
} from './common.js';
import { qrSvg, encodeQr } from './qr.js';

/**
 * 檢查登入狀態；沒登入就把整頁換成登入畫面。
 * 回傳 Promise，resolve 代表已通過驗證。
 */
export function requireLogin() {
  return new Promise((resolve) => {
    api('/api/admin/session').then(({ authenticated }) => {
      if (authenticated) return resolve();
      renderLogin();
    }).catch(() => renderLogin());
  });
}

/**
 * 換成登入畫面。這裡刻意不 resolve 外面的 Promise ——
 * 登入成功會直接 location.reload()，讓頁面帶著 cookie 重跑一次，
 * 所以呼叫端的後續程式碼在未登入時永遠不會執行。
 */
function renderLogin() {
  document.body.innerHTML = '';
  document.body.className = 'admin-body';

  const notice = el('div', { class: 'notice notice-error', hidden: true });
  const input = el('input', {
    type: 'password', name: 'password', id: 'pw',
    autocomplete: 'current-password', inputmode: 'numeric',
    placeholder: '請輸入工作人員密碼',
  });
  const button = el('button', { class: 'btn btn-block', type: 'submit', text: '登入' });

  const form = el('form', { class: 'card login-card', novalidate: true }, [
    el('div', { style: 'font-size:2rem;line-height:1;margin-bottom:6px', text: '🔒' }),
    el('h1', { text: '培力園 工作人員後台' }),
    notice,
    el('div', { class: 'field' }, [el('label', { for: 'pw', text: '密碼' }), input]),
    button,
    el('p', { class: 'help', style: 'margin-top:14px;text-align:center' }, [
      el('a', { href: '/', text: '← 回報名首頁' }),
    ]),
  ]);
  form.append(honeypot()); // 人機驗證（Cloudflare 小框框會出現在登入按鈕上面）

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    button.textContent = '登入中…';
    try {
      await apiHuman('/api/admin/login', { body: { password: input.value }, form });
      location.reload();
    } catch (err) {
      showNotice(notice, 'error', err.message);
      input.value = '';
      input.focus();
      button.disabled = false;
      button.textContent = '登入';
    }
  });

  document.body.append(el('div', { class: 'login-shell' }, form));
  input.focus();
}

/**
 * 「複製連結」按鈕共用：跟後端要短網址（自己網站上的 /s/代號，src/shortlink.js）再複製。
 * 按鈕上會短暫顯示複製了什麼。
 *
 * 剪貼簿要在「按下去的那一刻」就開始寫，Safari 才肯讓網頁寫入，
 * 所以用 ClipboardItem 先佔位、等短網址回來再填進去。
 */
export function copyLink(button, url, { idleText = button.textContent, promptText = '請複製這個連結：' } = {}) {
  const fetched = shortLinkOf(url);
  button.disabled = true;
  button.textContent = '複製中…';
  const write = window.ClipboardItem && navigator.clipboard?.write
    ? navigator.clipboard.write([new ClipboardItem({
      'text/plain': fetched.then((r) => new Blob([r.url], { type: 'text/plain' })),
    })])
    : fetched.then((r) => navigator.clipboard.writeText(r.url));
  return write
    .then(() => fetched)
    .then((r) => {
      // 夠短的（pse.is/abc）整串寫出來；自己的網域很長，只寫後面那段（…/s/k7m2）
      const bare = r.url.replace(/^https?:\/\//, '');
      const shown = bare.length <= 24 ? bare : `…${new URL(r.url).pathname}`;
      button.textContent = r.short ? `已複製 ${shown} ✓` : '已複製 ✓';
    })
    .catch(async () => {
      // 沒有剪貼簿權限（例如非 https）時，改用提示讓工作人員自己複製
      window.prompt(promptText, (await fetched).url);
    })
    .finally(() => {
      button.disabled = false;
      setTimeout(() => { button.textContent = idleText; }, 2500);
    });
}

/** 跟後端要這個路徑的短網址（關掉或出錯就給長網址）。 */
export async function shortLinkOf(url) {
  const target = new URL(url, location.origin);
  try {
    return await api('/api/admin/short-link', {
      method: 'POST', body: { path: target.pathname + target.search + target.hash },
    });
  } catch {
    return { url: target.href, longUrl: target.href, short: false };
  }
}

/**
 * QR Code 存成圖片（PNG）：上面 QR、下面活動名稱跟短網址，貼到海報或 LINE 都能用。
 * 直接用 QR 的格子畫在 canvas 上，不經過 SVG 圖片 —— Safari 畫 SVG 之後會不讓存檔。
 */
function downloadQrPng(url, title, filename) {
  const { size, modules } = encodeQr(url);
  const quiet = 4;
  const cell = Math.floor(720 / (size + quiet * 2));
  const qrPx = cell * (size + quiet * 2);
  const width = Math.max(qrPx, 800);
  const height = qrPx + 150;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#000';
  const left = Math.floor((width - qrPx) / 2);
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (modules[r][c]) ctx.fillRect(left + (c + quiet) * cell, (r + quiet) * cell, cell, cell);
    }
  }
  ctx.textAlign = 'center';
  ctx.fillStyle = '#0a3d2a';
  ctx.font = 'bold 34px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  // 名稱太長就截掉，不然會超出圖片
  let name = title;
  while (ctx.measureText(name).width > width - 60 && name.length > 4) name = name.slice(0, -1);
  if (name !== title) name = `${name.slice(0, -1)}…`;
  ctx.fillText(name, width / 2, qrPx + 55);
  ctx.fillStyle = '#4c6055';
  ctx.font = '26px "Noto Sans TC", "Microsoft JhengHei", sans-serif';
  ctx.fillText(url.replace(/^https?:\/\//, ''), width / 2, qrPx + 105);
  canvas.toBlob((blob) => {
    const href = URL.createObjectURL(blob);
    const link = el('a', { href, download: filename });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(href), 5000);
  }, 'image/png');
}

/**
 * 「QR Code」按鈕：跳出視窗，上面是短網址的 QR Code，可以複製連結、下載成圖片。
 * path：本站的路徑（例如 /activity/2026-11-21）；title：活動名稱（印在圖片下面、當檔名）。
 */
export async function showQrDialog({ path, title }) {
  const link = await shortLinkOf(path);
  const qr = el('div', { class: 'qr-big' });
  qr.innerHTML = qrSvg(link.url, { scale: 7, label: `${title} QR Code` });
  const copyBtn = el('button', { class: 'btn btn-ghost', type: 'button', text: '複製連結' });
  copyBtn.addEventListener('click', () => copyLink(copyBtn, path, { idleText: '複製連結' }));
  const safeName = String(title).replace(/[\\/:*?"<>|]+/g, '_');
  const dialog = el('dialog', { class: 'qr-dialog' }, [
    el('div', { class: 'dlg-head', text: `${title}　QR Code` }),
    el('div', { class: 'dlg-body', style: 'text-align:center' }, [
      qr,
      el('p', { class: 'qr-url', text: link.url }),
      el('p', { class: 'help', style: 'margin:4px 0 0', text: '掃了就會到報名頁。下載的圖片下面會印活動名稱跟這個網址，可以直接放進海報。' }),
    ]),
    el('div', { class: 'dlg-foot' }, [
      el('button', { class: 'btn btn-ghost', type: 'button', text: '關閉', onClick: () => dialog.close() }),
      copyBtn,
      el('button', {
        class: 'btn', type: 'button', text: '⬇ 下載 QR Code',
        onClick: () => downloadQrPng(link.url, title, `${safeName}_QR.png`),
      }),
    ]),
  ]);
  dialog.addEventListener('close', () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}

/**
 * 每天都會點的頁面留在外面，其餘收進「更多」。
 *
 * 九個項目全部攤開，一整條看下來反而找不到東西 ——
 * 活動管理是每天開的，簽到 QR 每場活動都要，場地借用天天有人登記、
 * 月報是每個月的交辦；學生資料、題庫、使用說明則是偶爾才進去一次。
 */
const MAIN_PAGES = [
  ['/admin', '活動管理'],
  ['/admin/checkin', '簽到 QR'],
  ['/admin/bookings', '場地借用'],
  ['/admin/reports', '月報統計'],
];
const MORE_PAGES = [
  ['/admin/students', '學生資料總集'],
  ['/admin/questions', '前後測題庫'],
  ['/admin/guide', '使用說明'],
];

/** 後台共用頁首。 */
export function adminHeader(current) {
  const link = (href, text) => el('a', {
    href, text, 'aria-current': href === current ? 'page' : null,
  });

  // 現在這一頁被收在「更多」裡的話，那顆按鈕自己要亮起來，
  // 不然使用者會找不到自己在哪一頁
  const insideMore = MORE_PAGES.some(([href]) => href === current);
  const more = el('details', { class: 'nav-more' });
  const summary = el('summary', {
    'aria-current': insideMore ? 'page' : null,
  }, [el('span', { text: '更多' }), el('span', { 'aria-hidden': 'true', text: '▾' })]);
  more.append(
    summary,
    el('div', { class: 'nav-more-panel' }, [
      ...MORE_PAGES.map(([href, text]) => link(href, text)),
      el('hr'),
      el('a', { href: '/', text: '前台 ↗' }),
      el('a', {
        href: '#',
        text: '登出',
        onClick: async (event) => {
          event.preventDefault();
          await api('/api/admin/logout', { method: 'POST' });
          location.href = '/admin';
        },
      }),
    ]),
  );
  // 點外面、按 Esc 就收起來 —— 展開的面板蓋住內容會擋到操作
  document.addEventListener('click', (event) => {
    if (more.open && !more.contains(event.target)) more.open = false;
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && more.open) more.open = false;
  });

  // 跟前台同一條標誌、同一種白底頁首（標誌是給淺色底設計的）
  const header = el('header', { class: 'site-header logo-header' }, [
    el('div', { class: 'wrap-wide bar' }, [
      el('a', { class: 'brand brand-banner', href: '/admin', 'aria-label': '新北市少年培力園 後台（回活動管理）' }, [
        el('picture', {}, [
          el('source', { srcset: '/assets/logo-banner.webp', type: 'image/webp' }),
          el('img', {
            src: '/assets/logo-banner.png', alt: '新北市少年培力園', width: '379', height: '64',
          }),
        ]),
      ]),
      el('nav', { class: 'site-nav' }, [
        ...MAIN_PAGES.map(([href, text]) => link(href, text)),
        more,
      ]),
    ]),
  ]);
  return header;
}

/**
 * 刪除前的確認對話框。要求輸入指定文字才能按下刪除，
 * 避免手滑刪掉整個活動的報名資料。
 */
export function confirmDelete({ title, message, confirmWord, danger = '確定刪除' }) {
  return new Promise((resolve) => {
    const dialog = el('dialog');
    const input = confirmWord
      ? el('input', { type: 'text', placeholder: `請輸入「${confirmWord}」` })
      : null;
    const ok = el('button', { class: 'btn btn-danger', text: danger });
    if (input) ok.disabled = true;

    if (input) {
      input.addEventListener('input', () => {
        ok.disabled = input.value.trim() !== confirmWord;
      });
    }

    const close = (result) => {
      dialog.close();
      dialog.remove();
      resolve(result);
    };

    dialog.append(
      el('div', { class: 'dlg-head', text: title }),
      el('div', { class: 'dlg-body' }, [
        el('p', { style: 'margin:0 0 12px;white-space:pre-wrap', text: message }),
        input,
      ]),
      el('div', { class: 'dlg-foot' }, [
        el('button', { class: 'btn btn-ghost', text: '取消', onClick: () => close(false) }),
        ok,
      ]),
    );
    ok.addEventListener('click', () => close(true));
    dialog.addEventListener('cancel', () => close(false));
    document.body.append(dialog);
    dialog.showModal();
    (input || ok).focus();
  });
}

export { api, $, el };
