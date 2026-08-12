// 前台行事曆：這個月哪幾天有什麼活動。
//
// 電腦跟手機給的是兩種東西，不是同一份東西縮小：
//   電腦 —— 一整面的月曆。螢幕夠寬，七欄攤開來一眼就看完整個月。
//   手機 —— 月曆縮到 375px 每格只剩 50px，塞不下活動名稱，硬塞只會變成
//           一堆看不懂的小點。所以手機改成「有課的日子」由近到遠列下來，
//           跟少年平常看訊息的習慣一樣，一路往下滑就好。
//
// 兩種版型都用同一份資料畫，靠 CSS 的 media query 決定顯示哪一個 ——
// 不用監聽視窗大小，轉螢幕方向也不會有一瞬間畫錯的空窗。

import { api, $, el, showNotice, hideNotice } from './common.js';
import { WEEKDAY_NAMES, weekdayOf } from './schedule.js';

const app = $('#app');
const notice = $('#notice');

let month = new URLSearchParams(location.search).get('month') || '';

const pad = (n) => String(n).padStart(2, '0');

/** 這個月往前/往後 n 個月。 */
function shiftMonth(iso, n) {
  const [y, m] = iso.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
}

function monthLabel(iso) {
  const [y, m] = iso.split('-');
  return `${y} 年 ${Number(m)} 月`;
}

/** 這一場的時間，寫成「09:00-12:00」。沒填就空字串。 */
function timeText(item) {
  if (!item.startTime) return '';
  return item.endTime ? `${item.startTime}-${item.endTime}` : item.startTime;
}

/**
 * 活動現在的狀態。
 * 月曆上用左邊色帶表示（cls），手機清單上用文字標籤（label）。
 */
function statusOf(item) {
  if (item.isPast) return { cls: 'is-past', badge: 'badge-past', label: '' };
  if (item.isFull) return { cls: 'is-full', badge: 'badge-full', label: '已額滿' };
  if (!item.isOpen) return { cls: 'is-closed', badge: 'badge-closed', label: '已截止' };
  return { cls: 'is-open', badge: 'badge-open', label: '可報名' };
}

// ---------------------------------------------------------------- 電腦版月曆

/**
 * 月曆一格。空白日（上個月月底、下個月月初）只留底色不放內容。
 */
function dayCell(date, items, today) {
  if (!date) return el('div', { class: 'cal-cell cal-blank' });

  const day = Number(date.slice(8, 10));
  const cell = el('div', {
    class: `cal-cell${date === today ? ' is-today' : ''}${items.length ? ' has-items' : ''}`,
  }, [
    el('div', { class: 'cal-daynum' }, [
      el('span', { text: String(day) }),
      date === today ? el('span', { class: 'cal-today-tag', text: '今天' }) : null,
    ]),
  ]);

  for (const item of items) {
    const status = statusOf(item);
    cell.append(el('a', {
      class: `cal-event ${status.cls}`,
      href: `/activity/${encodeURIComponent(item.slug)}`,
      title: [item.title, timeText(item), status.label].filter(Boolean).join('　'),
    }, [
      el('span', { class: 'cal-event-title', text: item.title }),
      timeText(item) ? el('span', { class: 'cal-event-time', text: timeText(item) }) : null,
    ]));
  }
  return cell;
}

/**
 * 整個月攤成 7 欄。
 * 從當月 1 號往前補到那一週的星期日，最後補到最後一週的星期六，
 * 格子才會是完整的方陣，不會缺一角。
 */
function monthGrid(data) {
  const byDate = new Map(data.days.map((d) => [d.date, d.items]));
  const [y, m] = data.month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = first.getUTCDay();

  const cells = [];
  for (let i = 0; i < lead; i += 1) cells.push(null);
  for (let d = 1; d <= lastDay; d += 1) cells.push(`${data.month}-${pad(d)}`);
  while (cells.length % 7 !== 0) cells.push(null);

  return el('div', { class: 'cal-grid-wrap' }, [
    el('div', { class: 'cal-head' }, WEEKDAY_NAMES.map((w, i) => el('div', {
      class: `cal-head-cell${i === 0 || i === 6 ? ' is-weekend' : ''}`,
      text: `週${w}`,
    }))),
    el('div', { class: 'cal-grid' },
      cells.map((date) => dayCell(date, byDate.get(date) || [], data.today))),
  ]);
}

// ---------------------------------------------------------------- 手機版清單

/**
 * 手機版：只列出「有課的日子」，沒課的日子不佔位置。
 * 一天一張，日期在左邊、活動在右邊，一路往下滑就看完整個月。
 */
function agenda(data) {
  const upcoming = data.days.filter((d) => d.date >= data.today);
  const past = data.days.filter((d) => d.date < data.today);
  const list = el('div', { class: 'cal-agenda' });

  const dayRow = (day) => {
    const isToday = day.date === data.today;
    return el('div', { class: `agenda-day${day.date < data.today ? ' is-past' : ''}` }, [
      el('div', { class: `agenda-date${isToday ? ' is-today' : ''}` }, [
        el('span', { class: 'agenda-dnum', text: String(Number(day.date.slice(8, 10))) }),
        el('span', { class: 'agenda-dow', text: isToday ? '今天' : `週${WEEKDAY_NAMES[weekdayOf(day.date)]}` }),
      ]),
      el('div', { class: 'agenda-items' }, day.items.map((item) => {
        const status = statusOf(item);
        return el('a', {
          class: 'agenda-item',
          href: `/activity/${encodeURIComponent(item.slug)}`,
        }, [
          el('div', { class: 'agenda-title', text: item.title }),
          el('div', { class: 'agenda-meta' }, [
            timeText(item) ? el('span', { text: timeText(item) }) : null,
            item.sessionTitle ? el('span', { text: item.sessionTitle }) : null,
            status.label ? el('span', { class: `badge ${status.badge}`, text: status.label }) : null,
          ]),
        ]);
      })),
    ]);
  };

  if (!data.days.length) {
    list.append(el('div', { class: 'empty' }, [
      el('strong', { text: '這個月沒有活動' }),
      el('p', { class: 'help', text: '換個月份看看，或到「最新活動」看看有沒有其他梯次。' }),
    ]));
    return list;
  }

  if (upcoming.length) {
    list.append(el('div', { class: 'agenda-group-title', text: '接下來' }));
    for (const day of upcoming) list.append(dayRow(day));
  }
  if (past.length) {
    list.append(el('div', { class: 'agenda-group-title', text: '這個月已經過去的' }));
    for (const day of past) list.append(dayRow(day));
  }
  return list;
}

// ---------------------------------------------------------------- 頁面

function toolbar(data) {
  const go = (target) => {
    month = target;
    // 網址帶著月份，這樣分享出去的連結會停在同一個月
    window.history.replaceState(null, '', target ? `?month=${target}` : location.pathname);
    load();
  };
  return el('div', { class: 'cal-bar' }, [
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', text: '← 上個月',
      onClick: () => go(shiftMonth(data.month, -1)),
    }),
    el('h2', { class: 'cal-month', text: monthLabel(data.month) }),
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', text: '下個月 →',
      onClick: () => go(shiftMonth(data.month, 1)),
    }),
    data.month === data.today.slice(0, 7)
      ? null
      : el('button', {
        class: 'btn btn-ghost btn-sm', type: 'button', text: '回到這個月',
        onClick: () => go(data.today.slice(0, 7)),
      }),
  ]);
}

function legend() {
  return el('div', { class: 'cal-legend' }, [
    ['is-open', '可報名'], ['is-full', '已額滿'], ['is-closed', '已截止或已結束'],
  ].map(([cls, label]) => el('span', {}, [
    el('span', { class: `cal-swatch ${cls}` }),
    el('span', { text: label }),
  ])));
}

async function load() {
  app.innerHTML = '<p class="loading">載入中…</p>';
  try {
    hideNotice(notice);
    const data = await api(`/api/calendar${month ? `?month=${encodeURIComponent(month)}` : ''}`);
    month = data.month;
    document.title = `${monthLabel(data.month)} 活動行事曆｜少年培力園`;

    app.innerHTML = '';
    app.append(
      toolbar(data),
      // 兩種版型都畫出來，由 CSS 決定這個螢幕該看哪一種
      el('div', { class: 'cal-desktop' }, [
        data.days.length
          ? null
          : el('p', { class: 'help', style: 'margin:0 0 10px', text: '這個月沒有活動。' }),
        monthGrid(data),
        legend(),
      ]),
      el('div', { class: 'cal-mobile' }, agenda(data)),
    );
  } catch (err) {
    app.innerHTML = '';
    showNotice(notice, 'error', err.message);
  }
}

load();
