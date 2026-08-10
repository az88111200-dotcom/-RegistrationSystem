// 後台的簽到 QR 頁：整個培力園只用這一張 QR。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';
import { requireLogin, adminHeader } from './admin-common.js';
import { qrSvg } from './qr.js';

const STORAGE_KEY = 'peiliyuan.checkinBase';

// 單次部署網址中間那串亂碼：9 個英數字，而且一定帶數字。
// 用「中間」而不是「結尾」比對很重要 —— 結尾那段是團隊代號
// （例如 wang-s-projects2613），正式網址也會有，比對結尾會把正式網址誤判成預覽。
const DEPLOY_HASH = /-([a-z0-9]{9})-/;

/**
 * Vercel 的「預覽網址」判斷。
 *
 * Vercel 一個專案會有好幾種網址，只有最短的那個正式網址是公開的：
 *   registration-system.vercel.app                      → 正式，任何人都打得開
 *   registration-system-git-<分支>-<團隊>.vercel.app     → 分支預覽，要登入
 *   registration-system-<9碼亂碼>-<團隊>.vercel.app      → 單次部署，要登入
 *
 * 後兩種掃碼的少年會先看到 Vercel 登入畫面 —— 這絕對不行，
 * 所以在這種網址底下產生 QR 要先擋下來，提醒工作人員換成正式網址。
 */
function isPreviewHost(host) {
  if (!host.endsWith('.vercel.app')) return false;
  if (host.includes('-git-')) return true;
  const found = DEPLOY_HASH.exec(host);
  return Boolean(found && /\d/.test(found[1]));
}

// 後端（Vercel）告訴我們的正式網域。載入後才會有值。
let serverBase = '';

/**
 * QR 要編進去的網站位址，依序採用：
 *   1. 工作人員手動指定的網域（存在這台電腦上）
 *   2. 後端回報的正式網域 —— 這是最可靠的，因為不管從哪個網址開後台都一樣
 *   3. 現在這個網址（本機開發時就是這個）
 */
function overrideBase() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';   // 瀏覽器不給用 localStorage（無痕模式）
  }
}

function baseUrl() {
  return overrideBase() || serverBase || location.origin;
}

function saveBase(value) {
  try {
    if (value) localStorage.setItem(STORAGE_KEY, value);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // 存不起來也沒關係，這一次仍然會用新的網址產生 QR
  }
}

const notice = el('div', { class: 'notice', hidden: true });
const card = el('div', { class: 'card', style: 'text-align:center;padding:28px 20px' });

/** 開新分頁排版成一張 A4 海報再列印。 */
function printPoster(url) {
  const w = window.open('', '_blank');
  if (!w) {
    showNotice(notice, 'error', '瀏覽器擋掉了列印視窗，請允許彈出視窗後再試一次。');
    return;
  }
  w.document.write(
    '<title>少年培力園 活動簽到</title>'
    + '<body style="font-family:system-ui,sans-serif;text-align:center;padding:48px 32px">'
    + '<h1 style="font-size:34px;margin:0 0 6px">活動簽到</h1>'
    + '<p style="font-size:19px;color:#555;margin:0 0 28px">'
    + '手機掃這個 QR Code，選你參加的課程、填姓名就完成簽到</p>'
    + qrSvg(url, { scale: 10 })
    + `<p style="color:#666;font-size:14px;margin-top:22px">${url}</p>`
    + '<p style="color:#888;font-size:13px">少年培力園｜洽詢電話 02-2297-7113</p>'
    + '</body>',
  );
  w.document.close();
  w.focus();
  w.print();
}

/** 讓工作人員把 QR 指到正式網域（例如剛好從預覽網址開後台的時候）。 */
function askForBase() {
  const current = baseUrl();
  const answer = prompt(
    '請輸入少年掃碼後要連到的正式網址（只要網域，不用加 /checkin）：\n'
    + '例：https://peiliyuan.vercel.app\n'
    + '（清空後按確定，就改回系統自動偵測到的網址）',
    current,
  );
  if (answer === null) return;
  const value = answer.trim().replace(/\/+$/, '');
  if (!value) {                       // 清空代表改回用現在這個網址
    saveBase('');
    render();
    return;
  }
  if (!/^https?:\/\/[^/\s]+$/.test(value)) {
    showNotice(notice, 'error', '網址格式怪怪的，請填成像 https://peiliyuan.vercel.app 這樣。');
    return;
  }
  saveBase(value);
  hideNotice(notice);
  render();
}

function render() {
  const base = baseUrl();
  const url = `${base}/checkin`;
  const host = new URL(base).hostname;

  const qr = el('div', { style: 'text-align:center' });
  qr.innerHTML = qrSvg(url, { scale: 7 });
  qr.firstChild.style.maxWidth = '100%';
  qr.firstChild.style.height = 'auto';

  // 預覽網址會被 Vercel 鎖住，掃碼的人會撞到登入畫面，先講清楚。
  // 注意 append(null) 會印出字串 "null"，所以這裡不能直接塞 null 進去。
  const warning = isPreviewHost(host)
    ? el('div', { class: 'notice notice-warn', style: 'text-align:left;margin:0 0 18px' }, [
      el('strong', { text: '這是預覽網址，少年掃碼會被要求登入 Vercel。' }),
      el('div', { style: 'margin-top:6px' },
        '請改用正式網址（Vercel 專案首頁最上面那一個）再列印，'
        + '或按下面的「改成正式網址」直接指定。'),
    ])
    : el('span', { hidden: true });

  // 這個網址是哪來的？印之前讓工作人員一眼看得出來
  let source = '目前開啟後台的網址';
  if (overrideBase()) source = '手動指定';
  else if (serverBase) source = '系統偵測到的正式網址';

  card.innerHTML = '';
  card.append(
    warning,
    qr,
    el('p', { class: 'help', style: 'margin-top:14px;word-break:break-all' }, [
      el('span', { text: url }),
      el('span', { style: 'opacity:.75', text: `　（${source}）` }),
    ]),
    el('div', { class: 'row', style: 'justify-content:center;margin-top:16px' }, [
      el('button', { class: 'btn', text: '列印成海報', onClick: () => printPoster(url) }),
      el('button', {
        class: 'btn btn-ghost', text: '複製簽到網址',
        onClick: async (event) => {
          try {
            await navigator.clipboard.writeText(url);
            event.target.textContent = '已複製 ✓';
          } catch {
            prompt('請複製這個簽到網址：', url);
          }
          setTimeout(() => { event.target.textContent = '複製簽到網址'; }, 1600);
        },
      }),
      el('a', {
        class: 'btn btn-ghost', href: '/checkin', target: '_blank', rel: 'noopener',
        text: '開啟簽到頁 ↗',
      }),
      el('button', { class: 'btn btn-ghost', text: '改成正式網址', onClick: askForBase }),
    ]),
  );
}

/** 今天有哪些課會出現在簽到頁上，讓工作人員先確認一次。 */
function todayPanel(date, sessions) {
  if (!sessions.length) {
    return el('div', { class: 'empty' }, [
      el('strong', { text: `${formatDate(date)} 沒有任何場次` }),
      '今天掃碼的少年會看到「今天沒有課程」。如果應該要有課，請到活動頁確認場次日期。',
    ]);
  }
  return el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '活動' }),
        el('th', { text: '堂次' }),
        el('th', { text: '時間' }),
        el('th', { text: '' }),
      ])),
      el('tbody', {}, sessions.map((s) => el('tr', {}, [
        el('td', { class: 'wrap-cell' }, el('a', {
          href: `/admin/activity/${s.activityId}`, style: 'font-weight:700', text: s.activityTitle,
        })),
        el('td', { text: s.title || '—' }),
        el('td', { text: s.startTime ? `${s.startTime}${s.endTime ? `-${s.endTime}` : ''}` : '—' }),
        el('td', {}, el('a', {
          class: 'btn btn-ghost btn-sm',
          href: `/admin/activity/${s.activityId}`, text: '看簽到名單',
        })),
      ]))),
    ]),
  ]);
}

(async () => {
  await requireLogin();
  const root = $('#root');
  root.innerHTML = '';

  const todaySlot = el('div', {}, el('p', { class: 'loading', text: '載入中…' }));

  root.append(
    adminHeader('/admin/checkin'),
    el('main', { class: 'wrap-wide' }, [
      el('div', { class: 'page-head' }, [
        el('h1', { text: '簽到 QR Code' }),
        el('p', { text: '所有活動共用這一張 QR。印一次貼在報到處就好，新增活動不用重印。' }),
      ]),
      notice,
      card,
      el('div', { class: 'card' }, [
        el('h2', { class: 'section-title', style: 'margin-top:0', text: '掃碼之後會看到什麼' }),
        el('p', { class: 'help', style: 'margin:0 0 14px' },
          '少年掃碼後會看到「今天」有課的所有場次，選一個、填姓名就完成簽到。'
          + '沒事先報名也能簽到，名單上會標成「未報名」。'),
        todaySlot,
      ]),
    ]),
  );
  render();

  // 先問後端正式網址是哪一個，拿到就重畫（工作人員從預覽網址開後台也不會印錯）
  try {
    const site = await api('/api/admin/site');
    if (site.baseUrl) {
      serverBase = site.baseUrl;
      render();
    }
  } catch {
    // 問不到就沿用現在的網址，頁面上的警告還是會提醒工作人員
  }

  try {
    const { date, sessions } = await api('/api/checkin/sessions');
    todaySlot.innerHTML = '';
    todaySlot.append(
      el('h3', { style: 'font-size:1rem;margin:0 0 10px', text: `${formatDate(date)} 的場次` }),
      todayPanel(date, sessions),
    );
  } catch (err) {
    todaySlot.innerHTML = '';
    showNotice(notice, 'error', err.message);
  }
})();
