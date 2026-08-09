// 後台的簽到 QR 頁：整個培力園只用這一張 QR。

import { api, $, el, formatDate, showNotice } from './common.js';
import { requireLogin, adminHeader } from './admin-common.js';
import { qrSvg } from './qr.js';

// 這張 QR 不帶任何活動代號，掃進去才會列出「今天有哪些課」讓少年自己選。
// 這樣一張印一次就能永久貼在報到處，不必每開一個活動就重印。
const CHECKIN_URL = `${location.origin}/checkin`;

const notice = el('div', { class: 'notice', hidden: true });

function qrBox(scale) {
  const box = el('div', { style: 'text-align:center' });
  box.innerHTML = qrSvg(CHECKIN_URL, { scale });
  box.firstChild.style.maxWidth = '100%';
  box.firstChild.style.height = 'auto';
  return box;
}

/** 開新分頁排版成一張 A4 海報再列印。 */
function printPoster() {
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
    + qrSvg(CHECKIN_URL, { scale: 10 })
    + `<p style="color:#666;font-size:14px;margin-top:22px">${CHECKIN_URL}</p>`
    + '<p style="color:#888;font-size:13px">少年培力園｜洽詢電話 02-2297-7113</p>'
    + '</body>',
  );
  w.document.close();
  w.focus();
  w.print();
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

  const copy = el('button', {
    class: 'btn btn-ghost', text: '複製簽到網址',
    onClick: async (event) => {
      try {
        await navigator.clipboard.writeText(CHECKIN_URL);
        event.target.textContent = '已複製 ✓';
      } catch {
        prompt('請複製這個簽到網址：', CHECKIN_URL);
      }
      setTimeout(() => { event.target.textContent = '複製簽到網址'; }, 1600);
    },
  });

  const todaySlot = el('div', {}, el('p', { class: 'loading', text: '載入中…' }));

  root.append(
    adminHeader('/admin/checkin'),
    el('main', { class: 'wrap-wide' }, [
      el('div', { class: 'page-head' }, [
        el('h1', { text: '簽到 QR Code' }),
        el('p', { text: '所有活動共用這一張 QR。印一次貼在報到處就好，新增活動不用重印。' }),
      ]),
      notice,
      el('div', { class: 'card', style: 'text-align:center;padding:28px 20px' }, [
        qrBox(7),
        el('p', { class: 'help', style: 'margin-top:14px;word-break:break-all', text: CHECKIN_URL }),
        el('div', { class: 'row', style: 'justify-content:center;margin-top:16px' }, [
          el('button', { class: 'btn', text: '列印成海報', onClick: printPoster }),
          copy,
          el('a', {
            class: 'btn btn-ghost', href: '/checkin', target: '_blank', rel: 'noopener',
            text: '開啟簽到頁 ↗',
          }),
        ]),
      ]),
      el('div', { class: 'card' }, [
        el('h2', { class: 'section-title', style: 'margin-top:0', text: '掃碼之後會看到什麼' }),
        el('p', { class: 'help', style: 'margin:0 0 14px' },
          '少年掃碼後會看到「今天」有課的所有場次，選一個、填姓名就完成簽到。'
          + '沒事先報名也能簽到，名單上會標成「未報名」。'),
        todaySlot,
      ]),
    ]),
  );

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
