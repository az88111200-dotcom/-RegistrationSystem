// 後台：月報統計。居住地區、年齡、身分別的人次，可以回看歷月與依活動分類篩選。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';
import { requireLogin, adminHeader, confirmDelete } from './admin-common.js';

const notice = el('div', { class: 'notice', hidden: true });
const body = el('div');
// 手動人次的表單放這裡。重新統計時整個 body 會重畫，
// 但這個節點是同一個，所以填到一半的表單不會被洗掉。
const manualFormSlot = el('div');
const manualAddRow = el('div', { class: 'row', style: 'margin-bottom:12px' });

/** 收掉手動人次的表單，把「新增」按鈕放回來。 */
function closeManualForm() {
  manualFormSlot.innerHTML = '';
  manualAddRow.hidden = false;
}

/** 目前的篩選條件，改了就重新查。 */
const filter = {
  month: '',
  basis: 'attendance',
  programCategory: '',
  serviceType: '',
  subCategory: '',
};

const queryString = () => new URLSearchParams(
  Object.entries(filter).filter(([, v]) => v !== ''),
).toString();

/** 2026-08 → 2026 年 8 月 */
function monthLabel(m) {
  const parts = /^(\d{4})-(\d{2})$/.exec(m || '');
  return parts ? `${parts[1]} 年 ${Number(parts[2])} 月` : m;
}

/** 一張分佈表：項目 + 人次 + 佔比。 */
function distributionTable(title, rows) {
  const total = rows.reduce((sum, r) => sum + Number(r.count), 0);

  const card = el('div', { class: 'card' }, [
    el('h3', { style: 'margin:0 0 12px;font-size:1.02rem', text: title }),
  ]);

  if (!rows.length) {
    card.append(el('p', { class: 'help', style: 'margin:0', text: '這個月沒有資料。' }));
    return card;
  }

  card.append(el('div', { class: 'table-scroll' }, [
    // stat-table：固定欄寬，三張分佈表的人次欄才會上下對齊
    el('table', { class: 'stat-table' }, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '項目' }),
        el('th', { class: 'num', text: '人次' }),
        el('th', { class: 'num', text: '佔比' }),
      ])),
      el('tbody', {}, [
        ...rows.map((r) => el('tr', {}, [
          el('td', { text: r.key }),
          el('td', { class: 'num', text: String(r.count) }),
          el('td', { class: 'num', text: total ? `${Math.round((r.count / total) * 100)}%` : '—' }),
        ])),
        el('tr', { style: 'font-weight:800;background:var(--leaf-50)' }, [
          el('td', { text: '合計' }),
          el('td', { class: 'num', text: String(total) }),
          el('td', { class: 'num', text: '100%' }),
        ]),
      ]),
    ]),
  ]));
  return card;
}

function activityTable(activities) {
  if (!activities.length) {
    return el('div', { class: 'empty' }, [
      el('strong', { text: '這個月沒有活動' }),
      '換一個月份，或把篩選條件放寬看看。',
    ]);
  }
  return el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '活動日期' }),
        el('th', { text: '活動名稱' }),
        el('th', { text: '方案分類' }),
        el('th', { text: '服務類型' }),
        el('th', { text: '細分類' }),
        el('th', { class: 'num', text: '報名人次' }),
      ])),
      el('tbody', {}, activities.map((a) => el('tr', {}, [
        el('td', { text: formatDate(a.eventDate) }),
        el('td', { class: 'wrap-cell' }, el('a', {
          href: `/admin/activity/${a.id}`, style: 'font-weight:700', text: a.title,
        })),
        el('td', { text: a.programCategory || '—' }),
        el('td', { text: a.serviceType || '—' }),
        el('td', { text: a.subCategory || '—' }),
        el('td', { class: 'num', text: String(a.registrationCount) }),
      ]))),
    ]),
  ]);
}

/** 提醒還沒分類的活動，不然月報會少算。 */
function uncategorisedWarning(activities) {
  const missing = activities.filter((a) => !a.programCategory || !a.serviceType);
  if (!missing.length) return null;
  return el('div', { class: 'notice notice-warn' }, [
    el('strong', { text: `有 ${missing.length} 個活動還沒分類：` }),
    el('div', { style: 'margin-top:4px' }, missing.map((a) => a.title).join('、')),
    el('div', { class: 'help', style: 'margin-top:6px' },
      '到「活動管理」編輯活動補上分類，依分類篩選時才算得到這些活動。'),
  ]);
}

let downloadLink;

async function load() {
  hideNotice(notice);
  body.innerHTML = '';
  body.append(el('p', { class: 'loading', text: '統計中…' }));

  const report = await api(`/api/admin/reports?${queryString()}`);
  if (downloadLink) downloadLink.href = `/api/admin/reports/export.csv?${queryString()}`;

  const label = report.month ? monthLabel(report.month) : '全部月份';
  const basisText = {
    attendance: '依出席月份 - 實際簽到人次',
    event: '依活動舉辦月份 - 實際報名人次',
  }[report.basis];
  const isAttendance = report.basis === 'attendance';

  body.innerHTML = '';
  body.append(
    el('div', { class: 'stat-grid' }, [
      [isAttendance ? '課程場次' : '活動場次', isAttendance ? 'sessions' : 'activities'],
      [isAttendance ? '實際簽到人次' : '實際報名人次', 'registrations'],
      ['實際人數', 'people'],
    ].map(([label, key]) => el('div', { class: 'stat' }, [
      el('div', { class: 'n', text: String(report.totals[key]) }),
      el('div', { class: 'l', text: label }),
      // 有手動填的數字才拆開顯示，不然每張卡都多一行沒用的字
      report.manualTotals[key]
        ? el('div', { class: 'stat-split' },
          `系統統計 ${report.counted[key]}　＋　手動填入 ${report.manualTotals[key]}`)
        : null,
    ]))),
    el('p', { class: 'help', style: 'margin:-8px 0 16px' },
      `${label}　·　${basisText}　·　`
      + (isAttendance
        // 交給政府的服務量用這個。候補只要人有來、有簽到就算進去，
        // 工作人員不必為了報表特地把候補改成正取。
        ? '「實際簽到人次」是簽到筆數，同一個人來三堂課算三人次；'
          + '候補的少年只要當天有來簽到就算進去，不用先改成正取；'
        : '「實際報名人次」是報名筆數，同一個人報兩個活動算兩人次；候補不列入計算；')
      + '「實際人數」是去掉重複後的人頭數。'
      // 手動填的沒有個人資料，下面三張分佈表算不進去，先講清楚免得對不起來
      + (report.manualTotals.registrations
        ? '　手動填入的人次沒有個人資料，只加進上面的總數，'
          + '不會出現在下面的居住地區／年齡／身分別統計裡。'
        : '')),
  );

  const warning = uncategorisedWarning(report.activities);
  if (warning) body.append(warning);

  body.append(
    distributionTable('居住地區人次', report.byDistrict),
    distributionTable('年齡人次', report.byAge),
    distributionTable('身分別人次', report.byIdentity),
    el('h2', { class: 'section-title', text: '本期活動明細' }),
    activityTable(report.activities),
    el('h2', { class: 'section-title', text: '手動填入的人次' }),
    manualSection(report),
  );

  return report;
}

// ---------------------------------------------------------------- 手動人次

/** 這筆手動人次的一列。 */
function manualRow(m, report) {
  return el('tr', {}, [
    el('td', { text: monthLabel(m.month) }),
    el('td', { class: 'wrap-cell' }, [
      el('strong', { text: m.title }),
      m.note ? el('div', { class: 'help', style: 'margin-top:2px', text: m.note }) : null,
    ]),
    el('td', { class: 'num', text: String(m.sessions) }),
    el('td', { class: 'num', text: String(m.headcount) }),
    el('td', { class: 'num', text: String(m.people) }),
    el('td', { text: m.programCategory || '—' }),
    el('td', { text: m.serviceType || '—' }),
    el('td', { text: m.subCategory || '—' }),
    el('td', {}, el('div', { class: 'row', style: 'gap:6px;flex-wrap:nowrap' }, [
      el('button', {
        class: 'btn btn-ghost btn-sm', text: '編輯',
        onClick: () => openManualForm(report, m),
      }),
      el('button', {
        class: 'btn btn-ghost btn-sm', text: '刪除',
        onClick: () => removeManual(m),
      }),
    ])),
  ]);
}

/** 手動人次區塊：說明、清單、新增按鈕。表單開在清單上面。 */
function manualSection(report) {
  const list = report.manualCounts;
  const totals = report.manualTotals;

  const section = el('div', {}, [
    el('p', { class: 'help', style: 'margin:-6px 0 12px' },
      '跟別的單位合辦、現場沒辦法一個一個簽到的活動，把服務量直接填在這裡，'
      + '會加進上面的總數。這些數字在下載的 CSV 裡也是分開列的，'
      + '交報表時看得出哪些有簽到紀錄可查、哪些是人工補的。'),
    manualFormSlot,
    manualAddRow,
  ]);

  manualAddRow.innerHTML = '';
  manualAddRow.append(el('button', {
    class: 'btn', text: '＋ 新增手動人次',
    onClick: () => openManualForm(report, null),
  }));
  // 表單開著的時候就把按鈕收起來，免得畫面上同時有兩個入口
  manualAddRow.hidden = manualFormSlot.childElementCount > 0;

  if (!list.length) {
    section.append(el('div', { class: 'empty' }, [
      el('strong', { text: '這個月沒有手動填入的人次' }),
      '合辦活動沒辦法簽到時，按上面的按鈕把人次補進來。',
    ]));
    return section;
  }

  section.append(el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '月份' }),
        el('th', { text: '活動名稱' }),
        el('th', { class: 'num', text: '場次' }),
        el('th', { class: 'num', text: '服務人次' }),
        el('th', { class: 'num', text: '實際人數' }),
        el('th', { text: '方案分類' }),
        el('th', { text: '服務類型' }),
        el('th', { text: '細分類' }),
        el('th', { text: '操作' }),
      ])),
      el('tbody', {}, [
        ...list.map((m) => manualRow(m, report)),
        el('tr', { style: 'font-weight:800;background:var(--leaf-50)' }, [
          el('td', { text: '小計' }),
          el('td', { text: `${list.length} 筆` }),
          el('td', { class: 'num', text: String(totals.sessions) }),
          el('td', { class: 'num', text: String(totals.registrations) }),
          el('td', { class: 'num', text: String(totals.people) }),
          el('td', {}), el('td', {}), el('td', {}), el('td', {}),
        ]),
      ]),
    ]),
  ]));
  return section;
}

/** 新增或編輯手動人次的表單。existing 有值就是編輯。 */
function openManualForm(report, existing) {
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
  const value = existing || {
    month: filter.month || now,
    title: '', headcount: '', people: '', sessions: 1,
    programCategory: filter.programCategory || '',
    serviceType: filter.serviceType || '',
    subCategory: filter.subCategory || '',
    note: '',
  };

  const field = (label, input, help) => el('div', { class: 'field' }, [
    el('label', {}, [label, help ? el('span', { class: 'help', text: help }) : null]),
    input,
  ]);
  const pick = (name, options, current, blank) => {
    const node = el('select', { name });
    node.append(el('option', { value: '', text: blank }));
    for (const opt of options) {
      const o = el('option', { value: opt, text: opt });
      if (opt === current) o.selected = true;
      node.append(o);
    }
    return node;
  };

  const formNotice = el('div', { class: 'notice', hidden: true });
  const form = el('form', { class: 'card' }, [
    el('h3', { style: 'margin:0 0 12px;font-size:1.02rem',
      text: existing ? '編輯手動人次' : '新增手動人次' }),
    formNotice,
    el('div', { class: 'grid-2' }, [
      field('月份', el('input', { type: 'month', name: 'month', value: value.month, required: true })),
      field('活動名稱', el('input', {
        type: 'text', name: 'title', value: value.title, required: true,
        placeholder: '例：與○○中學合辦生涯探索工作坊',
      })),
      field('場次', el('input', {
        type: 'number', name: 'sessions', min: '1', step: '1', value: String(value.sessions || 1),
      }), '這個活動這個月辦了幾場'),
      field('服務人次', el('input', {
        type: 'number', name: 'headcount', min: '1', step: '1',
        value: value.headcount === '' ? '' : String(value.headcount), required: true,
      }), '每一場的人數加起來'),
      field('實際人數', el('input', {
        type: 'number', name: 'people', min: '0', step: '1',
        value: value.people === '' ? '' : String(value.people),
      }), '去掉重複後的人頭數，不知道就留白'),
      field('方案分類', pick('programCategory', report.programCategories, value.programCategory, '（不分類）')),
      field('服務類型', pick('serviceType', report.serviceTypes, value.serviceType, '（不分類）')),
      field('細分類', el('input', {
        type: 'text', name: 'subCategory', value: value.subCategory, list: 'manual-sub-list',
      })),
      el('datalist', { id: 'manual-sub-list' },
        report.subCategories.map((s) => el('option', { value: s }))),
      el('div', { class: 'span-2' }, field('備註', el('input', {
        type: 'text', name: 'note', value: value.note,
        placeholder: '例：合辦單位、人次怎麼算來的',
      }))),
    ]),
    el('div', { class: 'row row-end' }, [
      el('button', {
        type: 'button', class: 'btn btn-ghost', text: '取消',
        onClick: closeManualForm,
      }),
      el('button', { type: 'submit', class: 'btn', text: existing ? '儲存' : '新增' }),
    ]),
  ]);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideNotice(formNotice);
    const data = Object.fromEntries(new FormData(form).entries());
    try {
      await api(existing ? `/api/admin/manual-counts/${existing.id}` : '/api/admin/manual-counts', {
        method: existing ? 'PATCH' : 'POST',
        body: {
          ...data,
          headcount: Number(data.headcount) || 0,
          people: Number(data.people) || 0,
          sessions: Number(data.sessions) || 1,
        },
      });
      closeManualForm();
      // 填在別的月份也看得到 —— 直接跳過去那個月
      if (filter.month && data.month !== filter.month) filter.month = data.month;
      await buildAll();
    } catch (err) {
      showNotice(formNotice, 'error', err.message);
    }
  });

  manualFormSlot.innerHTML = '';
  manualFormSlot.append(form);
  manualAddRow.hidden = true;
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
  form.querySelector('input[name="title"]').focus();
}

async function removeManual(m) {
  const ok = await confirmDelete({
    title: '刪除這筆手動人次',
    message: `「${m.title}」（${monthLabel(m.month)}，${m.headcount} 人次）刪掉後就不算進月報了。`,
    danger: '刪除',
  });
  if (!ok) return;
  try {
    await api(`/api/admin/manual-counts/${m.id}`, { method: 'DELETE' });
    await buildAll();
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
}

/** 篩選列。改任何一項就重新統計。 */
function buildToolbar(report) {
  const reload = () => load().catch((err) => showNotice(notice, 'error', err.message));

  const select = (key, placeholder, options, current) => {
    const node = el('select', { style: 'min-width:160px' });
    // 只有「全部月份」這種真的可以留白的欄位才需要空白選項。
    // 統計基準一定要選一個，多一個空白列只會讓人以為那是選項。
    if (placeholder) node.append(el('option', { value: '', text: placeholder }));
    for (const opt of options) {
      const o = el('option', { value: opt.value ?? opt, text: opt.label ?? opt });
      if ((opt.value ?? opt) === current) o.selected = true;
      node.append(o);
    }
    node.addEventListener('change', () => {
      filter[key] = node.value;
      // 換統計基準時，可選的月份清單也會不一樣，整頁重建最單純
      if (key === 'basis') buildAll();
      else reload();
    });
    return node;
  };

  downloadLink = el('a', {
    class: 'btn', href: `/api/admin/reports/export.csv?${queryString()}`,
    download: `培力園_月報統計_${report.month || '全部'}.csv`,
    text: '⬇ 下載統計（CSV）',
  });

  return el('div', { class: 'toolbar' }, [
    select('month', '全部月份', report.months.map((m) => ({ value: m, label: monthLabel(m) })), filter.month),
    select('basis', '', [
      { value: 'attendance', label: '依出席月份 - 實際簽到人次（政府月報用）' },
      { value: 'event', label: '依活動舉辦月份 - 實際報名人次' },
    ], filter.basis),
    select('programCategory', '全部方案分類', report.programCategories, filter.programCategory),
    select('serviceType', '全部服務類型', report.serviceTypes, filter.serviceType),
    report.subCategories.length
      ? select('subCategory', '全部細分類', report.subCategories, filter.subCategory)
      : null,
    el('button', { class: 'btn btn-ghost', text: '列印', onClick: () => window.print() }),
    downloadLink,
  ].filter(Boolean));
}

let toolbarSlot;

async function buildAll() {
  try {
    const report = await load();
    toolbarSlot.innerHTML = '';
    toolbarSlot.append(buildToolbar(report));
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
}

(async () => {
  await requireLogin();
  const root = $('#root');
  root.innerHTML = '';
  toolbarSlot = el('div');

  // 預設看上個月：月報通常是月初交前一個月的數字
  const now = new Date(Date.now() + 8 * 3600 * 1000);
  now.setUTCDate(1);
  now.setUTCMonth(now.getUTCMonth() - 1);
  filter.month = now.toISOString().slice(0, 7);

  root.append(
    adminHeader('/admin/reports'),
    el('main', { class: 'wrap-wide' }, [
      el('div', { class: 'page-head' }, [
        el('h1', { text: '月報統計' }),
        el('p', { text: '給政府的月報數字。可以回看任何一個月，也可以只看某一類方案的數字。' }),
      ]),
      notice,
      toolbarSlot,
      body,
    ]),
  );

  await buildAll();
  // 預設的上個月如果沒資料，就退回最近有資料的月份
  const report = await api(`/api/admin/reports?${queryString()}`).catch(() => null);
  if (report && report.totals.activities === 0 && report.months.length
      && !report.months.includes(filter.month)) {
    filter.month = report.months[0];
    await buildAll();
  }
})();
