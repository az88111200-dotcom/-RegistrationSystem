// 後台：月報統計。居住地區、年齡、身分別的人次，可以回看歷月與依活動分類篩選。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';
import { requireLogin, adminHeader } from './admin-common.js';

const notice = el('div', { class: 'notice', hidden: true });
const body = el('div');

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
    attendance: '依出席月份（實際簽到）',
    registration: '依報名月份',
    event: '依活動舉辦月份',
  }[report.basis];
  const isAttendance = report.basis === 'attendance';

  body.innerHTML = '';
  body.append(
    el('div', { class: 'stat-grid' }, [
      [isAttendance ? '課程場次' : '活動場次',
        isAttendance ? report.totals.sessions : report.totals.activities],
      [isAttendance ? '出席人次' : '報名人次（不含候補）', report.totals.registrations],
      ['實際人數', report.totals.people],
    ].map(([l, n]) => el('div', { class: 'stat' }, [
      el('div', { class: 'n', text: String(n) }),
      el('div', { class: 'l', text: l }),
    ]))),
    el('p', { class: 'help', style: 'margin:-8px 0 16px' },
      `${label}　·　${basisText}　·　`
      + (isAttendance
        // 交給政府的服務量用這個。候補只要人有來、有簽到就算進去，
        // 工作人員不必為了報表特地把候補改成正取。
        ? '「出席人次」是簽到筆數，同一個人來三堂課算三人次；'
          + '候補的少年只要當天有來簽到就算進去，不用先改成正取；'
        : '「報名人次」是報名筆數，同一個人報兩個活動算兩人次；候補不列入計算；')
      + '「實際人數」是去掉重複後的人頭數。'),
  );

  const warning = uncategorisedWarning(report.activities);
  if (warning) body.append(warning);

  body.append(
    distributionTable('居住地區人次', report.byDistrict),
    distributionTable('年齡人次', report.byAge),
    distributionTable('身分別人次', report.byIdentity),
    el('h2', { class: 'section-title', text: '本期活動明細' }),
    activityTable(report.activities),
  );

  return report;
}

/** 篩選列。改任何一項就重新統計。 */
function buildToolbar(report) {
  const reload = () => load().catch((err) => showNotice(notice, 'error', err.message));

  const select = (key, placeholder, options, current) => {
    const node = el('select', { style: 'min-width:160px' });
    node.append(el('option', { value: '', text: placeholder }));
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
      { value: 'attendance', label: '依出席月份（實際簽到）— 政府月報用' },
      { value: 'event', label: '依活動舉辦月份' },
      { value: 'registration', label: '依報名月份' },
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
