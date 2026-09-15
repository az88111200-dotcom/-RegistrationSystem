// 前台：場地借用。三個分頁 —— 借用表、我要預約、查詢/取消。
//
// 借用表在電腦上是月曆（點一天看當天詳情），手機上自動換成「未來兩週」
// 的清單，而且是「每天每個空間各一列」（沒人借的也列出來寫「尚無預約」）。
// 這是照園方原本那份表單的行為做的，社工跟少年都習慣那樣看。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';

const MOBILE_WIDTH = 650;
const LIST_DAYS = 14;

let schema = null;
let calendar = null;
/** 'month'（月曆）或 'list'（兩週清單）。窄螢幕自動用清單。 */
let view = window.innerWidth <= MOBILE_WIDTH ? 'list' : 'month';
let monthCursor = '';
let selectedDate = '';

const notice = $('#notice');
const calSlot = el('div');
const dayBox = el('div', { class: 'card', style: 'margin-top:16px' });

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (date, n) => {
  const d = new Date(`${date}T00:00:00`);
  d.setDate(d.getDate() + n);
  return ymd(d);
};
const monthOf = (date) => date.slice(0, 7);
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

// ---------------------------------------------------------------- 借用表

/** 這個月（或兩週）要跟後端要哪一段期間。 */
function range() {
  if (view === 'list') {
    const today = schema.today;
    return { from: today, to: addDays(today, LIST_DAYS - 1) };
  }
  const first = `${monthCursor}-01`;
  const last = new Date(Number(monthCursor.slice(0, 4)), Number(monthCursor.slice(5, 7)), 0);
  return { from: first, to: ymd(last) };
}

async function loadCalendar() {
  const { from, to } = range();
  calendar = await api(`/api/booking/calendar?from=${from}&to=${to}`);
  renderCalendar();
}

/** 週日、週一固定休館 —— 那幾天沒有任何資料，所以自己算。 */
function isClosedDay(date) {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 1;
}

/** 某一天的資料（沒有就給一個空的）。 */
function dayData(date) {
  const found = (calendar.days || []).find((d) => d.date === date);
  return found || { date, closed: isClosedDay(date), items: [] };
}

/** 一筆時段：時間 + 是誰（已經遮罩過）。 */
function slotLine(item) {
  if (item.kind === 'closure') {
    return el('div', { class: 'bk-slot bk-slot-closed' }, [
      el('span', { class: 'bk-time', text: `${item.startTime}-${item.endTime}` }),
      el('span', { text: `⚠️ 休館${item.reason ? `（${item.reason}）` : ''}` }),
    ]);
  }
  return el('div', { class: 'bk-slot' }, [
    el('span', { class: 'bk-time', text: item.startTime ? `${item.startTime}-${item.endTime}` : '整天' }),
    el('span', { class: 'bk-who', text: item.who }),
  ]);
}

/** 手機版：一天一張卡，裡面每個空間一列。 */
function listDay(date) {
  const data = dayData(date);
  const head = el('div', { class: 'bk-day-head' }, [
    el('strong', { text: formatDate(date) }),
  ]);
  if (data.closed) {
    return el('div', { class: 'card bk-day' }, [
      head, el('p', { class: 'help', style: 'margin:6px 0 0', text: '週日、週一固定休館' }),
    ]);
  }
  const whole = data.items.find((i) => i.kind === 'closure' && i.venueName === '全館');
  if (whole) {
    return el('div', { class: 'card bk-day' }, [
      head,
      el('p', { style: 'margin:6px 0 0;color:var(--danger)',
        text: `⛔ 全館休館${whole.reason ? `（${whole.reason}）` : ''}` }),
    ]);
  }
  return el('div', { class: 'card bk-day' }, [
    head,
    ...calendar.rooms.map((room) => {
      const items = data.items
        .filter((i) => i.venueName === room.name || i.venueName === '全館')
        .sort((a, b) => a.startTime.localeCompare(b.startTime));
      return el('div', { class: 'bk-room-row' }, [
        el('div', { class: 'bk-room-name', text: room.shortName || room.name }),
        el('div', { class: 'bk-room-slots' }, items.length
          ? items.map(slotLine)
          : [el('span', { class: 'help', style: 'margin:0', text: '尚無預約' })]),
      ]);
    }),
  ]);
}

/** 電腦版：月曆格子裡寫「時段 + 空間」。 */
function monthGrid() {
  const first = new Date(`${monthCursor}-01T00:00:00`);
  const startPad = first.getDay();
  const days = new Date(Number(monthCursor.slice(0, 4)), Number(monthCursor.slice(5, 7)), 0).getDate();
  const cells = [];
  for (let i = 0; i < startPad; i += 1) cells.push(el('div', { class: 'bk-cell bk-cell-blank' }));
  for (let d = 1; d <= days; d += 1) {
    const date = `${monthCursor}-${pad(d)}`;
    const data = dayData(date);
    const classes = ['bk-cell'];
    if (data.closed) classes.push('bk-cell-off');
    if (date === selectedDate) classes.push('bk-cell-picked');
    if (date === schema.today) classes.push('bk-cell-today');
    const items = [...data.items].sort((a, b) => a.startTime.localeCompare(b.startTime));
    const cell = el('button', { class: classes.join(' '), type: 'button' }, [
      el('span', { class: 'bk-daynum', text: String(d) }),
      data.closed
        ? el('span', { class: 'help', style: 'margin:0', text: '休館' })
        : el('span', { class: 'bk-cell-items' }, items.slice(0, 4).map((i) => el('span', {
          class: `bk-cell-item${i.kind === 'closure' ? ' bk-cell-item-closed' : ''}`,
          text: `${i.startTime || ''} ${i.shortName || i.venueName}`.trim(),
        }))),
      items.length > 4 ? el('span', { class: 'help', style: 'margin:0', text: `…還有 ${items.length - 4} 筆` }) : null,
    ]);
    cell.addEventListener('click', () => {
      selectedDate = date;
      renderCalendar();
      dayBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
    cells.push(cell);
  }
  return el('div', { class: 'bk-grid' }, [
    ...WEEKDAYS.map((w) => el('div', { class: 'bk-grid-head', text: w })),
    ...cells,
  ]);
}

/** 電腦版下面那塊「某一天的預約詳情」。 */
function renderDayBox() {
  dayBox.innerHTML = '';
  if (view === 'list') { dayBox.hidden = true; return; }
  dayBox.hidden = false;
  if (!selectedDate) {
    dayBox.append(el('p', { class: 'help', style: 'margin:0', text: '點上面的日期看當天的預約詳情 👆' }));
    return;
  }
  const data = dayData(selectedDate);
  dayBox.append(el('h3', { style: 'margin:0 0 10px',
    text: `📅 ${formatDate(selectedDate)} 預約詳情` }));
  if (data.closed) {
    dayBox.append(el('p', { class: 'help', style: 'margin:0', text: '週日、週一固定休館。' }));
    return;
  }
  const closures = data.items.filter((i) => i.kind === 'closure');
  const booked = data.items.filter((i) => i.kind !== 'closure');
  for (const c of closures) {
    dayBox.append(el('div', { class: 'notice notice-error', style: 'margin:0 0 10px' }, [
      el('strong', { text: `🛑 ${c.venueName} ${c.startTime}-${c.endTime} 休館` }),
      el('div', { class: 'help', style: 'margin:4px 0 0',
        text: `原因：${c.reason || '中心休館'}　·　此時段以外的時間，中心仍正常開放借用！` }),
    ]));
  }
  if (!booked.length) {
    dayBox.append(el('p', { style: 'margin:0;color:var(--ok);font-weight:700',
      text: '今日無預約，空間充裕歡迎借用！' }));
    return;
  }
  for (const room of calendar.rooms) {
    const items = booked.filter((i) => i.venueName === room.name)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
    if (!items.length) continue;
    dayBox.append(el('div', { class: 'bk-room-row' }, [
      el('div', { class: 'bk-room-name', text: room.shortName || room.name }),
      el('div', { class: 'bk-room-slots' }, items.map(slotLine)),
    ]));
  }
}

function renderCalendar() {
  calSlot.innerHTML = '';
  const toggle = (value, label) => {
    const btn = el('button', {
      class: `btn btn-sm${view === value ? '' : ' btn-ghost'}`, type: 'button', text: label,
    });
    btn.addEventListener('click', async () => {
      view = value;
      if (view === 'month' && !monthCursor) monthCursor = monthOf(schema.today);
      await loadCalendar();
    });
    return btn;
  };

  const bar = el('div', { class: 'row', style: 'justify-content:space-between;margin-bottom:12px' }, [
    view === 'month'
      ? el('div', { class: 'row' }, [
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '←', onClick: () => shiftMonth(-1) }),
        el('strong', { text: `${monthCursor.slice(0, 4)} 年 ${Number(monthCursor.slice(5, 7))} 月` }),
        el('button', { class: 'btn btn-ghost btn-sm', type: 'button', text: '→', onClick: () => shiftMonth(1) }),
      ])
      : el('strong', { text: '未來兩週' }),
    el('div', { class: 'row' }, [toggle('month', '月曆'), toggle('list', '兩週清單')]),
  ]);

  calSlot.append(bar, el('p', { class: 'help', style: 'margin:-4px 0 12px' },
    '🌟 此表顯示的是已被預約的時段及場地；沒列出來的時間都還借得到。'));
  if (view === 'list') {
    const days = [];
    for (let i = 0; i < LIST_DAYS; i += 1) days.push(addDays(schema.today, i));
    calSlot.append(el('div', {}, days.map(listDay)));
  } else {
    calSlot.append(monthGrid());
  }
  renderDayBox();
}

function shiftMonth(delta) {
  const d = new Date(`${monthCursor}-01T00:00:00`);
  d.setMonth(d.getMonth() + delta);
  monthCursor = ymd(d).slice(0, 7);
  selectedDate = '';
  loadCalendar();
}

// ---------------------------------------------------------------- 我要預約

/** 這個空間可以借的設備（沒有就不顯示那一區）。 */
function equipmentBox(venueName) {
  const list = schema.equipment[venueName] || [];
  const box = el('div', { class: 'eq-grid' });
  if (!list.length) { box.hidden = true; return box; }
  box.append(el('div', { class: 'eq-title', text: `🔌 ${venueName}可借用的設備（括號是現有數量）` }));
  for (const [name, max] of list) {
    const input = el('input', { type: 'number', min: '0', max: String(max), value: '0' });
    input.dataset.name = name;
    box.append(el('label', { class: 'eq-item' }, [
      el('span', { text: `${name}(${max})` }), input,
    ]));
  }
  return box;
}

function bookingForm() {
  const form = el('form', { novalidate: true });
  const venueSelect = el('select', { name: 'venueId', required: true });
  venueSelect.append(el('option', { value: '', text: '請選擇…' }));
  for (const v of schema.venues) venueSelect.append(el('option', { value: v.id, text: v.name }));

  const typeSelect = el('select', { name: 'activityType', required: true });
  typeSelect.append(el('option', { value: '', text: '請選擇…' }));
  for (const t of schema.activityTypes) typeSelect.append(el('option', { value: t, text: t }));

  const dateInput = el('input', { type: 'date', name: 'date', required: true, min: schema.today });
  const startInput = el('input', { type: 'time', name: 'startTime', required: true, step: '300' });
  const endInput = el('input', { type: 'time', name: 'endTime', required: true, step: '300' });
  const dayHint = el('p', { class: 'help', style: 'margin:6px 0 0' });

  let eqBox = equipmentBox('');
  const eqSlot = el('div');
  eqSlot.append(eqBox);
  venueSelect.addEventListener('change', () => {
    const name = venueSelect.options[venueSelect.selectedIndex].textContent;
    const fresh = equipmentBox(name);
    eqBox.replaceWith(fresh);
    eqBox = fresh;
  });

  /*
   * 選了日期就把時間欄位的範圍框好：那天開不開館、最早最晚幾點、
   * 單次上限 3 小時。伺服器還是會再擋一次，但先框起來比較好填。
   */
  const toMin = (t) => {
    const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : -1;
  };
  const toTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;

  const applyDayLimits = () => {
    const date = dateInput.value;
    if (!date) { dayHint.textContent = ''; return; }
    const day = new Date(`${date}T00:00:00`).getDay();
    if (day === 0 || day === 1) {
      dayHint.textContent = '⚠️ 週日、週一固定休館，請換一天。';
      dayHint.style.color = 'var(--danger)';
      startInput.value = '';
      endInput.value = '';
      return;
    }
    dayHint.style.color = '';
    const latest = day === 6 ? '18:00' : '20:00';
    const close = day === 6 ? '18:30' : '20:30';
    dayHint.textContent = `這一天 10:30 開始借用，最晚借到 ${latest}`
      + `（閉館 ${close}，要留 30 分鐘做閉館作業）。單次上限 3 小時。`;
    startInput.min = '10:30';
    startInput.max = latest;
    if (startInput.value) {
      if (toMin(startInput.value) < toMin('10:30')) startInput.value = '10:30';
      if (toMin(startInput.value) > toMin(latest)) startInput.value = latest;
      const maxEnd = Math.min(toMin(startInput.value) + 180, toMin(latest) + 30);
      endInput.min = toTime(toMin(startInput.value) + 30);
      endInput.max = toTime(maxEnd);
      if (!endInput.value) endInput.value = toTime(Math.min(toMin(startInput.value) + 60, maxEnd));
      else if (toMin(endInput.value) > maxEnd) endInput.value = toTime(maxEnd);
      else if (toMin(endInput.value) <= toMin(startInput.value)) endInput.value = endInput.min;
    }
  };
  dateInput.addEventListener('change', applyDayLimits);
  startInput.addEventListener('change', applyDayLimits);

  const field = (label, input, help) => el('div', { class: 'field' }, [
    el('label', {}, [el('span', { text: label }), help ? el('span', { class: 'help', text: help }) : null]),
    input,
  ]);

  form.append(
    el('div', { class: 'grid-2' }, [
      field('🎯 活動類型', typeSelect),
      field('🏠 借用空間', venueSelect),
    ]),
    eqSlot,
    el('div', { class: 'grid-2' }, [
      field('📅 借用日期', dateInput),
      el('div', {}, [
        el('div', { class: 'grid-2' }, [
          field('⏰ 開始時間', startInput),
          field('⏳ 結束時間', endInput, '單次上限 3 小時'),
        ]),
      ]),
    ]),
    dayHint,
    el('div', { class: 'grid-2', style: 'margin-top:16px' }, [
      field('🙋 單位／社團名稱', el('input', { type: 'text', name: 'org', placeholder: '沒有就填「無」' })),
      field('👤 借用人姓名', el('input', { type: 'text', name: 'borrower', required: true })),
      field('📱 聯絡電話', el('input', {
        type: 'tel', name: 'phone', required: true, maxlength: '10',
        placeholder: '09xxxxxxxx', pattern: '09\\d{8}',
      }), '之後用這支電話查詢或取消'),
      field('👥 總借用人數', el('input', { type: 'number', name: 'headcount', min: '1', required: true }),
        '一樓練團室最少 3 人'),
    ]),
    field('📝 備註（選填）', el('input', { type: 'text', name: 'note', placeholder: '例：需要提早 10 分鐘進場佈置' })),
  );

  const button = el('button', { class: 'btn btn-sun btn-block', type: 'submit', text: '送出預約 ✨' });
  form.append(el('div', { style: 'margin-top:20px' }, button));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice(notice);
    const data = Object.fromEntries(new FormData(form));
    const equipment = [...eqSlot.querySelectorAll('input[type="number"]')]
      .filter((i) => Number(i.value) > 0)
      .map((i) => `${i.dataset.name}×${i.value}`)
      .join('、');
    button.disabled = true;
    try {
      const result = await api('/api/booking', {
        method: 'POST',
        body: { ...data, equipment, purpose: data.activityType },
      });
      form.reset();
      const b = result.booking;
      showNotice(notice, 'ok',
        `✅ 預約成功！${b.venueName} ${formatDate(b.date)} ${b.startTime}-${b.endTime}。`
        + '請務必回到「場地借用表」確認是否已預約成功；要改或取消就到「查詢／取消」。');
      await loadCalendar();
    } catch (err) {
      showNotice(notice, 'error', err.message);
    } finally {
      button.disabled = false;
    }
  });
  return form;
}

// ---------------------------------------------------------------- 查詢／取消

function lookupPanel() {
  const input = el('input', {
    type: 'tel', maxlength: '10', placeholder: '請輸入預約時填的電話', style: 'max-width:280px',
  });
  const results = el('div', { style: 'margin-top:16px' });

  const search = async () => {
    results.innerHTML = '';
    hideNotice(notice);
    try {
      const { bookings } = await api('/api/booking/mine', { method: 'POST', body: { phone: input.value } });
      if (!bookings.length) {
        results.append(el('div', { class: 'empty' }, [
          el('strong', { text: '查不到未來的預約' }), '只會列出今天以後、還有效的預約。',
        ]));
        return;
      }
      for (const b of bookings) {
        const cancel = el('button', { class: 'btn btn-danger btn-sm', text: '取消預約' });
        cancel.addEventListener('click', async () => {
          if (!window.confirm(`確定要取消 ${formatDate(b.date)} ${b.startTime}-${b.endTime} 的 ${b.venueName} 嗎？`)) return;
          cancel.disabled = true;
          try {
            await api(`/api/booking/${b.id}/cancel`, { method: 'POST', body: { phone: input.value } });
            showNotice(notice, 'ok', '✅ 預約已取消，那個時段釋出給其他人了。');
            await search();
            await loadCalendar();
          } catch (err) {
            showNotice(notice, 'error', err.message);
            cancel.disabled = false;
          }
        });
        results.append(el('div', { class: 'card', style: 'margin-bottom:10px' }, [
          el('div', { class: 'row', style: 'justify-content:space-between' }, [
            el('div', {}, [
              el('strong', { text: b.venueName }),
              el('div', { class: 'help', style: 'margin:4px 0 0',
                text: `${formatDate(b.date)} ${b.startTime}-${b.endTime}　·　${b.headcount} 人` }),
              b.equipment ? el('div', { class: 'help', style: 'margin:2px 0 0', text: `設備：${b.equipment}` }) : null,
            ]),
            cancel,
          ]),
        ]));
      }
    } catch (err) {
      showNotice(notice, 'error', err.message);
    }
  };

  const button = el('button', { class: 'btn', text: '查詢' });
  button.addEventListener('click', search);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') search(); });

  return el('div', {}, [
    el('p', { class: 'help', style: 'margin:0 0 10px', text: '用預約時填的電話查詢，可以在這裡取消。' }),
    el('div', { class: 'row' }, [input, button]),
    results,
  ]);
}

// ---------------------------------------------------------------- 借用規範

let rulesShown = false;
function rulesPanel() {
  const section = (title, items) => el('div', {}, [
    el('h3', { style: 'margin:18px 0 8px', text: title }),
    el('ul', { class: 'guide-list' }, items.map(([name, text]) => el('li', {}, [
      el('strong', { text: `${name}：` }), el('span', { text }),
    ]))),
  ]);
  const box = el('details', { class: 'editor', id: 'rules' });
  box.append(
    el('summary', { text: '📖 場地借用規範與申請辦法' }),
    el('div', { class: 'editor-body' }, [
      section('📌 申請辦法與須知', schema.rules.apply),
      section('⚠️ 空間使用規範', schema.rules.use),
    ]),
  );
  return box;
}

// ---------------------------------------------------------------- 組起來

function tabs() {
  const panels = {
    calendar: el('div', {}, [calSlot, dayBox]),
    book: el('div', {}, [rulesPanel(), el('div', { class: 'card', style: 'margin-top:16px' }, bookingForm())]),
    mine: el('div', { class: 'card' }, lookupPanel()),
  };
  const bar = el('div', { class: 'tabs' });
  const show = (key) => {
    for (const [name, panel] of Object.entries(panels)) panel.hidden = name !== key;
    for (const btn of bar.children) {
      btn.setAttribute('aria-selected', btn.dataset.key === key ? 'true' : 'false');
    }
  };
  for (const [key, label] of [
    ['calendar', '📅 場地借用表'], ['book', '✍️ 我要預約'], ['mine', '🔍 查詢／取消'],
  ]) {
    const btn = el('button', { class: 'tab', type: 'button', text: label });
    btn.dataset.key = key;
    btn.addEventListener('click', () => {
      show(key);
      // 第一次進「我要預約」自動把規範攤開，看過一次再自己收起來
      if (key === 'book' && !rulesShown) {
        const rules = document.getElementById('rules');
        if (rules) rules.open = true;
        rulesShown = true;
      }
    });
    bar.append(btn);
  }
  const wrap = el('div', {}, [bar, ...Object.values(panels)]);
  show('calendar');
  return wrap;
}

(async () => {
  const root = $('#root');
  try {
    schema = await api('/api/booking/schema');
  } catch (err) {
    root.innerHTML = '';
    showNotice(notice, 'error', err.message);
    return;
  }
  monthCursor = monthOf(schema.today);
  $('#opening').textContent = `培力園的空間開放借用，線上就可以查時段、登記、取消。　${schema.opening}`;

  root.innerHTML = '';
  // 還沒正式啟用的時候，進來第一眼就要看到 —— 不然有人會真的在這裡登記
  if (schema.underConstruction) {
    root.append(el('div', { class: 'wip' }, [
      el('strong', { text: schema.constructionNotice.title }),
      el('span', { text: schema.constructionNotice.body }),
    ]));
  }
  root.append(tabs());
  await loadCalendar();

  // 轉螢幕方向／改視窗寬度時，在月曆與清單之間自動切換
  let wasMobile = window.innerWidth <= MOBILE_WIDTH;
  window.addEventListener('resize', () => {
    const isMobile = window.innerWidth <= MOBILE_WIDTH;
    if (isMobile === wasMobile) return;
    wasMobile = isMobile;
    view = isMobile ? 'list' : 'month';
    loadCalendar();
  });
})();
