// 後台：場地借用。哪個場地、哪一天、幾點到幾點被誰借走了。
//
// 重點是「不會借重複」——送出前就比同一個場地同一天的時段，
// 撞到直接擋下來並講出跟誰撞到，不用等現場兩組人撞在一起才發現。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';
import { requireLogin, adminHeader, confirmDelete } from './admin-common.js';

const notice = el('div', { class: 'notice', hidden: true });
const body = el('div');
const formSlot = el('div');

let data = { bookings: [], venues: [], months: [] };
const filter = { month: '', venueId: '', status: 'booked' };

/** 2026-09 → 2026 年 9 月 */
function monthLabel(m) {
  const parts = /^(\d{4})-(\d{2})$/.exec(m || '');
  return parts ? `${parts[1]} 年 ${Number(parts[2])} 月` : m;
}

const activeVenues = () => data.venues.filter((v) => v.active);

// ---------------------------------------------------------------- 借用單

/**
 * 借用登記表。existing 有值就是修改。
 * 場地、日期、起訖時間、借用人是必填 —— 少了任何一個就判斷不出撞不撞得到。
 */
function openForm(existing) {
  const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  const value = existing || {
    venueId: filter.venueId || (activeVenues()[0]?.id ?? ''),
    date: today,
    startTime: '',
    endTime: '',
    purpose: '',
    org: '',
    borrower: '',
    phone: '',
    headcount: '',
    equipment: '',
    note: '',
  };

  const field = (label, input, help, required = false) => el('div', { class: 'field' }, [
    el('label', {}, [
      el('span', { text: label }),
      required ? el('span', { class: 'req', text: '*' }) : null,
      help ? el('span', { class: 'help', text: help }) : null,
    ]),
    input,
  ]);

  const venue = el('select', { name: 'venueId', required: true });
  // 停用的場地不出現在新的借用單裡，但既有那一筆如果借的是它，要留著才改得動
  const options = data.venues.filter((v) => v.active || v.id === value.venueId);
  for (const v of options) {
    const option = el('option', {
      value: v.id,
      text: v.name + (v.capacity ? `（可容納 ${v.capacity} 人）` : '') + (v.active ? '' : '（已停用）'),
    });
    if (v.id === value.venueId) option.selected = true;
    venue.append(option);
  }

  const formNotice = el('div', { class: 'notice', hidden: true });
  const form = el('form', { class: 'card' }, [
    el('h3', { style: 'margin:0 0 12px;font-size:1.02rem', text: existing ? '修改借用' : '登記借用' }),
    formNotice,
    el('div', { class: 'grid-2' }, [
      field('場地', venue, '', true),
      field('借用日期', el('input', { type: 'date', name: 'date', value: value.date, required: true }), '', true),
      field('開始時間', el('input', { type: 'time', name: 'startTime', value: value.startTime, required: true }), '', true),
      field('結束時間', el('input', { type: 'time', name: 'endTime', value: value.endTime, required: true }), '', true),
      field('借用人', el('input', {
        type: 'text', name: 'borrower', value: value.borrower, required: true,
        placeholder: '聯絡人姓名',
      }), '', true),
      field('借用單位', el('input', {
        type: 'text', name: 'org', value: value.org, placeholder: '例：某某國中輔導室、園內方案',
      })),
      field('聯絡電話', el('input', { type: 'text', name: 'phone', value: value.phone })),
      field('使用人數', el('input', {
        type: 'number', name: 'headcount', min: '0', step: '1',
        value: value.headcount === '' ? '' : String(value.headcount),
      })),
      el('div', { class: 'span-2' }, field('用途', el('input', {
        type: 'text', name: 'purpose', value: value.purpose,
        placeholder: '例：小團體、家長座談、社區共餐',
      }))),
      el('div', { class: 'span-2' }, field('需要的設備', el('input', {
        type: 'text', name: 'equipment', value: value.equipment,
        placeholder: '例：投影機、音響、桌椅 20 套',
      }))),
      el('div', { class: 'span-2' }, field('備註', el('input', {
        type: 'text', name: 'note', value: value.note,
      }))),
    ]),
    el('div', { class: 'row row-end' }, [
      el('button', { type: 'button', class: 'btn btn-ghost', text: '取消', onClick: closeForm }),
      el('button', { type: 'submit', class: 'btn', text: existing ? '儲存' : '登記' }),
    ]),
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice(formNotice);
    const values = Object.fromEntries(new FormData(form).entries());
    try {
      await api(existing ? `/api/admin/bookings/${existing.id}` : '/api/admin/bookings', {
        method: existing ? 'PATCH' : 'POST',
        body: { ...values, headcount: Number(values.headcount) || 0 },
      });
      closeForm();
      // 登記到別的月份也要看得到，直接跳過去那個月
      if (filter.month && values.date.slice(0, 7) !== filter.month) {
        filter.month = values.date.slice(0, 7);
      }
      await load();
      showNotice(notice, 'ok', existing ? '借用紀錄已更新。' : '登記完成。');
    } catch (err) {
      showNotice(formNotice, 'error', err.message);
    }
  });

  formSlot.innerHTML = '';
  formSlot.append(form);
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function closeForm() {
  formSlot.innerHTML = '';
}

async function cancelBooking(booking) {
  try {
    await api(`/api/admin/bookings/${booking.id}`, {
      method: 'PATCH', body: { status: 'cancelled' },
    });
    await load();
    showNotice(notice, 'ok', `已取消 ${booking.venueName} ${formatDate(booking.date)} 的借用。`);
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
}

async function restoreBooking(booking) {
  try {
    await api(`/api/admin/bookings/${booking.id}`, { method: 'PATCH', body: { status: 'booked' } });
    await load();
    showNotice(notice, 'ok', '已恢復這筆借用。');
  } catch (err) {
    // 恢復時可能已經被別人借走了，錯誤訊息會講清楚跟誰撞到
    showNotice(notice, 'error', err.message);
  }
}

async function removeBooking(booking) {
  const ok = await confirmDelete({
    title: '刪除借用紀錄',
    message: `${booking.venueName}　${formatDate(booking.date)} ${booking.startTime}-${booking.endTime}\n`
      + `（${booking.borrower}）刪掉之後就查不到了。只是不借了的話，用「取消」就好。`,
    danger: '刪除',
  });
  if (!ok) return;
  try {
    await api(`/api/admin/bookings/${booking.id}`, { method: 'DELETE' });
    await load();
    showNotice(notice, 'ok', '已刪除這筆借用紀錄。');
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
}

// ---------------------------------------------------------------- 清單

function bookingRow(b) {
  const cancelled = b.status === 'cancelled';
  return el('tr', { style: cancelled ? 'opacity:.55' : null }, [
    el('td', { class: 'wrap-cell' }, [
      el('strong', { text: `${b.startTime}-${b.endTime}` }),
      el('div', { class: 'help', style: 'margin:2px 0 0', text: b.venueName }),
    ]),
    el('td', { class: 'wrap-cell' }, [
      el('span', { text: b.purpose || '—' }),
      cancelled ? el('span', { class: 'badge badge-closed', style: 'margin-left:6px', text: '已取消' }) : null,
      b.equipment ? el('div', { class: 'help', style: 'margin:2px 0 0', text: `設備：${b.equipment}` }) : null,
      b.note ? el('div', { class: 'help', style: 'margin:2px 0 0', text: b.note }) : null,
    ]),
    el('td', { class: 'wrap-cell' }, [
      el('span', { text: b.borrower }),
      b.org ? el('div', { class: 'help', style: 'margin:2px 0 0', text: b.org }) : null,
      b.phone ? el('div', { class: 'help', style: 'margin:2px 0 0', text: b.phone }) : null,
    ]),
    el('td', { class: 'num', text: b.headcount ? String(b.headcount) : '—' }),
    el('td', {}, el('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, [
      el('button', { class: 'btn btn-ghost btn-sm', text: '修改', onClick: () => openForm(b) }),
      cancelled
        ? el('button', { class: 'btn btn-ghost btn-sm', text: '恢復', onClick: () => restoreBooking(b) })
        : el('button', { class: 'btn btn-ghost btn-sm', text: '取消', onClick: () => cancelBooking(b) }),
      el('button', { class: 'btn btn-danger btn-sm', text: '刪除', onClick: () => removeBooking(b) }),
    ])),
  ]);
}

/** 一天一段：同一天的借用排在一起，一眼看得出那天空間被用掉多少。 */
function dayBlock(date, list) {
  return el('div', { class: 'day-block' }, [
    el('h3', { class: 'day-head' }, [
      el('span', { text: formatDate(date) }),
      el('span', { class: 'help', style: 'margin:0', text: `${list.length} 筆借用` }),
    ]),
    el('div', { class: 'table-scroll' }, [
      el('table', {}, [
        el('thead', {}, el('tr', {}, [
          el('th', { text: '時間與場地' }),
          el('th', { text: '用途' }),
          el('th', { text: '借用人' }),
          el('th', { class: 'num', text: '人數' }),
          el('th', { text: '操作' }),
        ])),
        el('tbody', {}, list.map(bookingRow)),
      ]),
    ]),
  ]);
}

function renderList() {
  body.innerHTML = '';

  if (!data.venues.length) {
    body.append(el('div', { class: 'empty' }, [
      el('strong', { text: '還沒有建立場地' }),
      '先在下面的「場地」把可以借的空間建起來，才能登記借用。',
    ]));
    return;
  }
  if (!data.bookings.length) {
    body.append(el('div', { class: 'empty' }, [
      el('strong', { text: filter.month ? `${monthLabel(filter.month)}沒有借用紀錄` : '還沒有借用紀錄' }),
      '按上面的「＋ 登記借用」新增一筆。',
    ]));
    return;
  }

  const byDate = new Map();
  for (const b of data.bookings) {
    if (!byDate.has(b.date)) byDate.set(b.date, []);
    byDate.get(b.date).push(b);
  }
  for (const [date, list] of byDate) body.append(dayBlock(date, list));
}

// ---------------------------------------------------------------- 場地

function venueRow(v) {
  return el('tr', {}, [
    el('td', { class: 'wrap-cell' }, [
      el('strong', { text: v.name }),
      v.active ? null : el('span', { class: 'badge badge-closed', style: 'margin-left:6px', text: '停用中' }),
      v.note ? el('div', { class: 'help', style: 'margin:2px 0 0', text: v.note }) : null,
    ]),
    el('td', { class: 'num', text: v.capacity ? String(v.capacity) : '—' }),
    el('td', { class: 'num', text: String(v.bookingCount ?? 0) }),
    el('td', {}, el('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm', text: v.active ? '停用' : '啟用',
        onClick: async () => {
          try {
            await api(`/api/admin/venues/${v.id}`, { method: 'PATCH', body: { active: !v.active } });
            await load();
          } catch (err) {
            showNotice(notice, 'error', err.message);
          }
        },
      }),
      el('button', {
        class: 'btn btn-danger btn-sm', text: '刪除',
        onClick: async () => {
          const ok = await confirmDelete({
            title: '刪除場地',
            message: `確定要刪除「${v.name}」嗎？借過的場地不能刪，只能停用。`,
            danger: '刪除',
          });
          if (!ok) return;
          try {
            await api(`/api/admin/venues/${v.id}`, { method: 'DELETE' });
            await load();
            showNotice(notice, 'ok', `已刪除場地「${v.name}」。`);
          } catch (err) {
            showNotice(notice, 'error', err.message);
          }
        },
      }),
    ])),
  ]);
}

function venuePanel() {
  const name = el('input', { type: 'text', placeholder: '場地名稱（例：一樓團體室）', style: 'flex:1 1 200px' });
  const capacity = el('input', { type: 'number', min: '0', step: '1', placeholder: '可容納人數', style: 'width:130px' });
  const note = el('input', { type: 'text', placeholder: '備註（設備、注意事項）', style: 'flex:1 1 220px' });
  const add = el('button', { class: 'btn', text: '新增場地' });

  add.addEventListener('click', async () => {
    if (!name.value.trim()) {
      showNotice(notice, 'error', '請填場地名稱。');
      name.focus();
      return;
    }
    try {
      await api('/api/admin/venues', {
        method: 'POST',
        body: { name: name.value, capacity: Number(capacity.value) || 0, note: note.value },
      });
      name.value = '';
      capacity.value = '';
      note.value = '';
      await load();
    } catch (err) {
      showNotice(notice, 'error', err.message);
    }
  });

  const panel = el('details', { class: 'editor' }, [
    el('summary', { text: `場地（${data.venues.length}）` }),
    el('div', { class: 'editor-body' }, [
      el('div', { class: 'row', style: 'margin-bottom:14px' }, [name, capacity, note, add]),
      data.venues.length
        ? el('div', { class: 'table-scroll' }, [
          el('table', {}, [
            el('thead', {}, el('tr', {}, [
              el('th', { text: '場地' }),
              el('th', { class: 'num', text: '可容納' }),
              el('th', { class: 'num', text: '借用次數' }),
              el('th', { text: '操作' }),
            ])),
            el('tbody', {}, data.venues.map(venueRow)),
          ]),
        ])
        : el('p', { class: 'help', style: 'margin:0', text: '還沒有建立場地。' }),
    ]),
  ]);
  return panel;
}

// ---------------------------------------------------------------- 工具列

let toolbarSlot;

function renderToolbar() {
  toolbarSlot.innerHTML = '';

  const select = (key, placeholder, options, current) => {
    const node = el('select', { 'aria-label': placeholder });
    node.append(el('option', { value: '', text: placeholder }));
    for (const opt of options) {
      const option = el('option', { value: opt.value, text: opt.label });
      if (opt.value === current) option.selected = true;
      node.append(option);
    }
    node.addEventListener('change', () => {
      filter[key] = node.value;
      load().catch((err) => showNotice(notice, 'error', err.message));
    });
    return node;
  };

  toolbarSlot.append(el('div', { class: 'toolbar' }, [
    select('month', '全部月份', data.months.map((m) => ({ value: m, label: monthLabel(m) })), filter.month),
    select('venueId', '全部場地', data.venues.map((v) => ({ value: v.id, label: v.name })), filter.venueId),
    select('status', '含已取消', [
      { value: 'booked', label: '只看有效的' },
      { value: 'cancelled', label: '只看已取消' },
    ], filter.status),
    el('button', { class: 'btn', text: '＋ 登記借用', onClick: () => openForm(null) }),
    el('button', { class: 'btn btn-ghost', text: '列印', onClick: () => window.print() }),
  ]));
}

async function load() {
  hideNotice(notice);
  const params = new URLSearchParams(
    Object.entries(filter).filter(([, v]) => v !== ''),
  );
  data = await api(`/api/admin/bookings?${params.toString()}`);
  renderToolbar();
  renderList();
  venueSlot.innerHTML = '';
  venueSlot.append(venuePanel());
}

const venueSlot = el('div', { style: 'margin-top:28px' });

(async () => {
  await requireLogin();
  const root = $('#root');
  root.innerHTML = '';
  toolbarSlot = el('div');

  // 預設看這個月：借用大部分是看當月怎麼排
  filter.month = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);

  root.append(
    adminHeader('/admin/bookings'),
    el('main', { class: 'wrap-wide' }, [
      el('div', { class: 'page-head' }, [
        el('h1', { text: '場地借用' }),
        el('p', { text: '哪個場地、哪一天、幾點到幾點被誰借走了。同一個場地同一時段不會被借兩次，撞到會擋下來並告訴你跟誰撞到。' }),
      ]),
      notice,
      toolbarSlot,
      formSlot,
      body,
      el('h2', { class: 'section-title', text: '場地' }),
      venueSlot,
    ]),
  );

  try {
    await load();
    // 這個月沒有借用紀錄的話，退回最近有紀錄的月份，免得一進來像壞掉
    if (!data.bookings.length && data.months.length && !data.months.includes(filter.month)) {
      filter.month = data.months[0];
      await load();
    }
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
})();
