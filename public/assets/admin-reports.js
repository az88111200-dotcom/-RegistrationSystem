// 後台：月報統計。居住地區、年齡、身分別的人次，可以回看歷月與依活動分類篩選。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';
import { requireLogin, adminHeader, confirmDelete } from './admin-common.js';

const notice = el('div', { class: 'notice', hidden: true });
const body = el('div');
// 手動人次的表單放這裡。重新統計時整個 body 會重畫，
// 但這個節點是同一個，所以填到一半的表單不會被洗掉。
const manualFormSlot = el('div');
const manualAddRow = el('div', { class: 'row', style: 'margin-bottom:12px' });
// 月報其他欄位（參訪、社區工作、會議訓練、FB／IG）畫在這裡
const extrasSlot = el('div');
// 補登人次的居住地區與年齡（補登的課沒有個別資料，只能照月份填）
const profileSlot = el('div');

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

/*
 * 一張分佈表：項目 + 人次 + 佔比。
 *
 * 人次可能來自兩邊：線上報名簽到（系統自己算的）與手動補登（社工填的）。
 * 兩邊都有的時候才拆成兩欄 —— 沒有補登的月份多兩欄只是噪音。
 */
function distributionTable(title, rows) {
  const num = (v) => Number(v) || 0;
  const total = rows.reduce((sum, r) => sum + num(r.count), 0);
  const split = rows.some((r) => num(r.manual) > 0);

  const card = el('div', { class: 'card' }, [
    el('h3', { style: 'margin:0 0 12px;font-size:1.02rem', text: title }),
  ]);

  if (!rows.length) {
    card.append(el('p', { class: 'help', style: 'margin:0', text: '這個月沒有資料。' }));
    return card;
  }

  const head = [el('th', { text: '項目' })];
  if (split) {
    head.push(el('th', { class: 'num', text: '簽到' }), el('th', { class: 'num', text: '補登' }));
  }
  head.push(el('th', { class: 'num', text: '人次' }), el('th', { class: 'num', text: '佔比' }));

  const cells = (r) => {
    const out = [el('td', { text: r.key })];
    if (split) {
      out.push(
        el('td', { class: 'num', text: String(num(r.counted)) }),
        el('td', { class: 'num', text: String(num(r.manual)) }),
      );
    }
    out.push(
      el('td', { class: 'num', text: String(num(r.count)) }),
      el('td', { class: 'num', text: total ? `${Math.round((num(r.count) / total) * 100)}%` : '—' }),
    );
    return out;
  };

  const sumOf = (field) => rows.reduce((sum, r) => sum + num(r[field]), 0);
  const footer = [el('td', { text: '合計' })];
  if (split) {
    footer.push(
      el('td', { class: 'num', text: String(sumOf('counted')) }),
      el('td', { class: 'num', text: String(sumOf('manual')) }),
    );
  }
  footer.push(
    el('td', { class: 'num', text: String(total) }),
    el('td', { class: 'num', text: '100%' }),
  );

  card.append(el('div', { class: 'table-scroll' }, [
    // stat-table：固定欄寬，三張分佈表的人次欄才會上下對齊
    el('table', { class: split ? 'stat-table stat-table-split' : 'stat-table' }, [
      el('thead', {}, el('tr', {}, head)),
      el('tbody', {}, [
        ...rows.map((r) => el('tr', {}, cells(r))),
        el('tr', { style: 'font-weight:800;background:var(--leaf-50)' }, footer),
      ]),
    ]),
  ]));
  return card;
}

/*
 * 三張分佈表。
 *
 * 三張都沒資料時（那個月沒有人簽到）併成一行字就好 —— 三張卡各自
 * 寫一次「這個月沒有資料」會佔掉快一個螢幕，卻什麼也沒告訴人。
 */
function distributions(report) {
  const tables = [
    ['居住地區人次', report.byDistrict],
    ['年齡人次', report.byAge],
    ['身分別人次', report.byIdentity],
  ];
  if (tables.every(([, rows]) => !rows.length)) {
    return [el('p', { class: 'help', style: 'margin:18px 0' },
      '這個月沒有簽到紀錄，也還沒填補登人次的居住地區與年齡，'
      + '所以沒有居住地區／年齡／身分別的分佈。')];
  }
  return tables.map(([title, rows]) => distributionTable(title, rows));
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
let bureauLink;

/**
 * 社會局月報的下載連結。
 *
 * 那份表是一個月一張，沒選月份就產不出來 —— 這時把按鈕變成不能按的樣子，
 * 並把原因寫在按鈕上，不要讓人按了才發現沒反應。
 */
function updateBureauLink(month) {
  if (!bureauLink) return;
  if (month) {
    bureauLink.href = `/api/admin/reports/bureau.xlsx?month=${encodeURIComponent(month)}`;
    bureauLink.download = `培力園_社會局月報_${month.replace('-', '')}.xlsx`;
    bureauLink.textContent = '📗 社會局月報（Excel）';
    bureauLink.classList.remove('btn-disabled');
  } else {
    bureauLink.removeAttribute('href');
    bureauLink.textContent = '📗 社會局月報（要先選月份）';
    bureauLink.classList.add('btn-disabled');
  }
}

async function load() {
  hideNotice(notice);
  body.innerHTML = '';
  body.append(el('p', { class: 'loading', text: '統計中…' }));

  const report = await api(`/api/admin/reports?${queryString()}`);
  if (downloadLink) downloadLink.href = `/api/admin/reports/export.csv?${queryString()}`;
  updateBureauLink(report.month);

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
      // 補登的身分別換算得出來，居住地區與年齡要自己填，先講清楚免得對不起來
      + (report.manualTotals.registrations
        ? '　補登的人次沒有個人資料，身分別可以直接換算，'
          + '居住地區與年齡要在下面「補登人次的居住地區／年齡」自己填，才會進分佈表。'
        : '')),
  );

  const warning = uncategorisedWarning(report.activities);
  if (warning) body.append(warning);

  body.append(
    // 補登放在最上面：月底要做的事就是把沒進系統的課補進來，
    // 下面那些統計表是補完之後回頭核對用的
    // 月底要動手做的兩件事擺最上面，下面的統計表是補完之後回頭核對用的
    el('h2', { class: 'section-title', text: '補登活動人次' }),
    manualSection(report),
    profileSlot,
    el('h2', { class: 'section-title', text: '月報其他欄位' }),
    extrasSlot,
    ...distributions(report),
    el('h2', { class: 'section-title', text: '本期活動明細' }),
    activityTable(report.activities),
  );

  // 手填的那幾塊另外拿一次，慢一點沒關係，不要卡住上面的統計
  extrasSlot.innerHTML = '';
  profileSlot.innerHTML = '';
  extrasSlot.append(el('p', { class: 'help', text: '載入中…' }));
  extrasSection(report.month, report.manualTotals.registrations)
    .then(({ extras, profile }) => {
      extrasSlot.innerHTML = '';
      extrasSlot.append(extras);
      profileSlot.innerHTML = '';
      if (profile) profileSlot.append(profile);
    })
    .catch((err) => {
      extrasSlot.innerHTML = '';
      extrasSlot.append(el('p', { class: 'help', text: `讀不到：${err.message}` }));
    });

  return report;
}

// ---------------------------------------------------------------- 手動人次

/** 2026-11 有幾天。Date 的第 0 天就是上個月的最後一天。 */
function lastDayOf(month) {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 2026-08-05 → 8/5（三）。沒有日期就顯示月份。 */
function dayLabel(m) {
  if (!m.date) return monthLabel(m.month);
  const d = new Date(`${m.date}T00:00:00Z`);
  const week = '日一二三四五六'[d.getUTCDay()];
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${week}）`;
}

/** 這筆補登的一列。 */
function manualRow(m, report) {
  const split = m.generalMale + m.generalFemale + m.nativeMale + m.nativeFemale;
  return el('tr', {}, [
    el('td', { text: dayLabel(m) }),
    el('td', { class: 'wrap-cell' }, [
      el('strong', { text: m.title }),
      m.note ? el('div', { class: 'help', style: 'margin-top:2px', text: m.note }) : null,
    ]),
    el('td', { text: m.serviceType || '—' }),
    el('td', { text: m.subCategory || '—' }),
    el('td', { class: 'num', text: String(m.generalMale) }),
    el('td', { class: 'num', text: String(m.generalFemale) }),
    el('td', { class: 'num', text: String(m.nativeMale) }),
    el('td', { class: 'num', text: String(m.nativeFemale) }),
    // 舊資料只有總人次、沒分男女，標出來讓社工知道那幾筆進不了社會局月報的分格
    el('td', { class: 'num' }, split
      ? el('strong', { text: String(m.headcount) })
      : el('span', { class: 'help', title: '當初只填了總人次，沒有分男女與身分別', text: `${m.headcount}（未分）` })),
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
      '沒辦法一場一場開進系統的課程（例如烘焙課一個月好幾次、每次來的人都不一樣），'
      + '在這裡一次補完整個月。會加進上面的總數，也會進社會局月報的活動明細。'),
    manualFormSlot,
    manualAddRow,
  ]);

  manualAddRow.innerHTML = '';
  manualAddRow.append(el('button', {
    class: 'btn', text: '＋ 補登一個課程的人次',
    onClick: () => openBatchForm(report),
  }));
  // 表單開著的時候就把按鈕收起來，免得畫面上同時有兩個入口
  manualAddRow.hidden = manualFormSlot.childElementCount > 0;

  if (!list.length) {
    section.append(el('div', { class: 'empty' }, [
      el('strong', { text: '這個月還沒有補登的人次' }),
      '沒進系統的課程，按上面的按鈕一次把整個月補完。',
    ]));
    return section;
  }

  const sum = (key) => list.reduce((n, m) => n + m[key], 0);
  section.append(el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { rowspan: '2', text: '日期' }),
          el('th', { rowspan: '2', text: '活動名稱' }),
          el('th', { rowspan: '2', text: '服務類型' }),
          el('th', { rowspan: '2', text: '項目' }),
          el('th', { colspan: '2', class: 'num', text: '一般生' }),
          el('th', { colspan: '2', class: 'num', text: '原住民' }),
          el('th', { rowspan: '2', class: 'num', text: '合計' }),
          el('th', { rowspan: '2', text: '操作' }),
        ]),
        el('tr', {}, [
          el('th', { class: 'num', text: '男' }),
          el('th', { class: 'num', text: '女' }),
          el('th', { class: 'num', text: '男' }),
          el('th', { class: 'num', text: '女' }),
        ]),
      ]),
      el('tbody', {}, [
        ...list.map((m) => manualRow(m, report)),
        el('tr', { style: 'font-weight:800;background:var(--leaf-50)' }, [
          el('td', { text: '小計' }),
          el('td', { text: `${list.length} 場` }),
          el('td', {}), el('td', {}),
          el('td', { class: 'num', text: String(sum('generalMale')) }),
          el('td', { class: 'num', text: String(sum('generalFemale')) }),
          el('td', { class: 'num', text: String(sum('nativeMale')) }),
          el('td', { class: 'num', text: String(sum('nativeFemale')) }),
          el('td', { class: 'num', text: String(totals.registrations) }),
          el('td', {}),
        ]),
      ]),
    ]),
  ]));
  return section;
}

/**
 * 一次補一整個課程的表單。
 *
 * 上面填一次共用的（活動名稱、服務類型、項目），下面一場一列填日期與人數。
 * 這是為了烘焙課那種「一個月上好幾次、每次來的人都不一樣」的課設計的 ——
 * 共用的東西不要重複打，變動的東西一列一列排好，用 Tab 一路填到底。
 */
function openBatchForm(report) {
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
  /*
   * 要補到哪個月，讓社工自己選、而且看得到。
   * 這裡限制日期只能落在這個月內 —— 補登最容易出、也最難發現的錯
   * 就是月份填錯（尤其月初在補上個月的資料時）。
   */
  const monthInput = el('input', {
    type: 'month', name: 'month', required: true, value: filter.month || now,
  });
  const monthOf = () => monthInput.value || now;

  const formNotice = el('div', { class: 'notice', hidden: true });
  const rowsBody = el('tbody');
  const totalCell = el('strong', { text: '0' });
  const countCell = el('span', { class: 'help', text: '' });

  /** 重算下面那條「總共幾場、幾人次」。 */
  function retotal() {
    let people = 0;
    let filled = 0;
    for (const tr of rowsBody.children) {
      const date = tr.querySelector('input[type="date"]').value;
      const n = [...tr.querySelectorAll('input[type="number"]')]
        .reduce((sum, i) => sum + (Number(i.value) || 0), 0);
      tr.querySelector('.row-sum').textContent = n ? String(n) : '';
      if (date || n) { people += n; filled += 1; }
    }
    totalCell.textContent = String(people);
    countCell.textContent = filled ? `${filled} 場` : '還沒填';
  }

  /** 一列 = 一場。 */
  function addRow(date = '') {
    const num = () => el('input', {
      type: 'number', min: '0', step: '1', placeholder: '0',
      style: 'width:100%;min-width:52px;text-align:right',
    });
    const cells = [num(), num(), num(), num()];
    const dateInput = el('input', {
      type: 'date', value: date,
      // 限制在選定的月份裡，填錯月份是最容易發生也最難發現的錯。
      // 月底那天要真的算出來 —— 寫死 31 號在只有 30 天的月份是無效日期
      min: `${monthOf()}-01`, max: `${monthOf()}-${String(lastDayOf(monthOf())).padStart(2, '0')}`,
      style: 'width:100%;min-width:140px',
    });
    const sum = el('td', { class: 'num row-sum' });
    const tr = el('tr', {}, [
      el('td', {}, dateInput),
      ...cells.map((c) => el('td', {}, c)),
      sum,
      el('td', {}, el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', text: '✕',
        title: '刪掉這一列',
        onClick: () => { tr.remove(); if (!rowsBody.children.length) addRow(); retotal(); },
      })),
    ]);
    // 填到最後一列就自動再長一列，不用一直去按「再加一場」
    tr.addEventListener('input', () => {
      retotal();
      if (tr === rowsBody.lastElementChild) addRow();
    });
    rowsBody.append(tr);
    return tr;
  }

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
  const field = (label, input, help) => el('div', { class: 'field' }, [
    el('label', {}, [label, help ? el('span', { class: 'help', text: help }) : null]),
    input,
  ]);

  const form = el('form', { class: 'card' }, [
    el('h3', { style: 'margin:0 0 4px;font-size:1.02rem', text: '補登一個課程的人次' }),
    el('p', { class: 'help', style: 'margin:0 0 12px' },
      '上面填一次就好，下面一場一列。日期只能填在選定的月份裡。'),
    formNotice,
    el('div', { class: 'grid-2' }, [
      field('補到哪個月', monthInput),
      field('活動名稱', el('input', {
        type: 'text', name: 'title', required: true, placeholder: '例：烘焙課',
      }), '整個課程共用一個名稱'),
      field('項目', el('input', {
        type: 'text', name: 'subCategory', list: 'manual-sub-list',
        value: filter.subCategory || '', placeholder: '例：社團、就業培力',
      }), '社會局月報「項目」那一欄'),
      field('服務類型', pick('serviceType', report.serviceTypes, filter.serviceType || '', '（不分類）')),
      field('方案分類', pick('programCategory', report.programCategories, filter.programCategory || '', '（不分類）')),
      el('datalist', { id: 'manual-sub-list' },
        report.subCategories.map((s) => el('option', { value: s }))),
      el('div', { class: 'span-2' }, field('備註', el('input', {
        type: 'text', name: 'note', placeholder: '例：合辦單位、人次怎麼算來的（可不填）',
      }))),
    ]),
    el('div', { class: 'table-scroll', style: 'margin-top:8px' }, [
      el('table', { class: 'batch-table' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { rowspan: '2', text: '日期' }),
            el('th', { colspan: '2', class: 'num', text: '一般生' }),
            el('th', { colspan: '2', class: 'num', text: '原住民' }),
            el('th', { rowspan: '2', class: 'num', text: '小計' }),
            el('th', { rowspan: '2' }),
          ]),
          el('tr', {}, [
            el('th', { class: 'num', text: '男' }),
            el('th', { class: 'num', text: '女' }),
            el('th', { class: 'num', text: '男' }),
            el('th', { class: 'num', text: '女' }),
          ]),
        ]),
        rowsBody,
      ]),
    ]),
    el('div', { class: 'row', style: 'margin-top:10px;align-items:center;gap:12px' }, [
      el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', text: '＋ 再加一場',
        onClick: () => addRow(),
      }),
      el('span', { class: 'help' }, ['合計 ', totalCell, ' 人次　', countCell]),
    ]),
    el('div', { class: 'row row-end', style: 'margin-top:12px' }, [
      el('button', { type: 'button', class: 'btn btn-ghost', text: '取消', onClick: closeManualForm }),
      el('button', { type: 'submit', class: 'btn', text: '全部補登' }),
    ]),
  ]);

  // 改月份時，已經在畫面上的那幾列也要跟著換範圍，
  // 不然限制只有新長出來的列才有
  monthInput.addEventListener('change', () => {
    const m = monthOf();
    const min = `${m}-01`;
    const max = `${m}-${String(lastDayOf(m)).padStart(2, '0')}`;
    for (const tr of rowsBody.children) {
      const input = tr.querySelector('input[type="date"]');
      input.min = min;
      input.max = max;
      // 換月份之後已經填的日期就不對了，清掉比留著錯的好
      if (input.value && input.value.slice(0, 7) !== m) input.value = '';
    }
    retotal();
  });

  addRow();
  addRow();
  addRow();
  retotal();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    hideNotice(formNotice);
    const shared = Object.fromEntries(new FormData(form).entries());

    const rows = [];
    for (const tr of rowsBody.children) {
      const date = tr.querySelector('input[type="date"]').value;
      const [gm, gf, nm, nf] = [...tr.querySelectorAll('input[type="number"]')]
        .map((i) => Number(i.value) || 0);
      // 整列都空白的略過 —— 最後一列本來就是自動長出來的空列
      if (!date && !(gm + gf + nm + nf)) continue;
      if (!date) {
        showNotice(formNotice, 'error', '有一列填了人數但沒填日期。');
        return;
      }
      rows.push({ date, generalMale: gm, generalFemale: gf, nativeMale: nm, nativeFemale: nf });
    }
    if (!rows.length) {
      showNotice(formNotice, 'error', '至少要填一場（日期加人數）。');
      return;
    }

    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.textContent = '補登中…';
    try {
      const result = await api('/api/admin/manual-counts', { method: 'POST', body: { shared, rows } });
      closeManualForm();
      if (filter.month && result.month !== filter.month) filter.month = result.month;
      await buildAll();
      showNotice(notice, 'ok',
        `已補登 ${result.created} 場、${result.headcount} 人次。`);
    } catch (err) {
      showNotice(formNotice, 'error', err.message);
      button.disabled = false;
      button.textContent = '全部補登';
    }
  });

  manualFormSlot.innerHTML = '';
  manualFormSlot.append(form);
  manualAddRow.hidden = true;
  form.scrollIntoView({ block: 'center', behavior: 'smooth' });
  form.querySelector('input[name="title"]').focus();
}

/** 編輯某一場補登的人次。 */
function openManualForm(report, existing) {
  const now = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 7);
  const value = existing || {
    month: filter.month || now,
    date: '', title: '', headcount: '', people: '', sessions: 1,
    generalMale: 0, generalFemale: 0, nativeMale: 0, nativeFemale: 0,
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
      text: existing ? '編輯這一場' : '新增一場' }),
    formNotice,
    el('div', { class: 'grid-2' }, [
      field('日期', el('input', {
        type: 'date', name: 'date', value: value.date,
        // 舊資料只有月份沒有日期，補上日期才進得了社會局月報的活動明細
        placeholder: value.date ? '' : '舊資料沒有日期，補一個',
      }), value.date ? '' : '早期補登的只有月份，填上日期才會出現在社會局月報'),
      field('活動名稱', el('input', {
        type: 'text', name: 'title', value: value.title, required: true,
        placeholder: '例：烘焙課',
      })),
      field('服務類型', pick('serviceType', report.serviceTypes, value.serviceType, '（不分類）')),
      field('項目', el('input', {
        type: 'text', name: 'subCategory', value: value.subCategory, list: 'manual-sub-list',
      })),
      field('一般生 男', el('input', {
        type: 'number', name: 'generalMale', min: '0', step: '1', value: String(value.generalMale || 0),
      })),
      field('一般生 女', el('input', {
        type: 'number', name: 'generalFemale', min: '0', step: '1', value: String(value.generalFemale || 0),
      })),
      field('原住民 男', el('input', {
        type: 'number', name: 'nativeMale', min: '0', step: '1', value: String(value.nativeMale || 0),
      })),
      field('原住民 女', el('input', {
        type: 'number', name: 'nativeFemale', min: '0', step: '1', value: String(value.nativeFemale || 0),
      })),
      field('方案分類', pick('programCategory', report.programCategories, value.programCategory, '（不分類）')),
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
          // 日期還沒補的舊資料，月份要沿用原本的
          month: data.date ? data.date.slice(0, 7) : value.month,
          generalMale: Number(data.generalMale) || 0,
          generalFemale: Number(data.generalFemale) || 0,
          nativeMale: Number(data.nativeMale) || 0,
          nativeFemale: Number(data.nativeFemale) || 0,
          // 四格加起來就是服務人次；四格都還沒分的舊資料沿用原本的數字，
          // 不然只是改個備註就會被當成「沒填人數」擋下來
          headcount: value.headcount || 0,
          people: value.people || 0,
        },
      });
      closeManualForm();
      // 填在別的月份也看得到 —— 直接跳過去那個月
      const month = data.date ? data.date.slice(0, 7) : value.month;
      if (filter.month && month !== filter.month) filter.month = month;
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

  const select = (key, placeholder, options, current, label) => {
    // 這幾個下拉沒有可見的標題，讀螢幕軟體要靠 aria-label 才知道是在選什麼
    const node = el('select', { style: 'min-width:160px', 'aria-label': label || placeholder });
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

  /*
   * 社會局那份表要選定月份才產得出來（它就是一個月一張），
   * 所以沒選月份時按鈕是暗的，並且直接寫明原因。
   */
  bureauLink = el('a', {
    class: 'btn btn-ghost', text: '📗 社會局月報（Excel）',
    title: '照社會局那份月報表的版面，場地使用與活動明細會自動填好，其他區塊留白讓你填',
  });
  updateBureauLink(report.month);

  return el('div', { class: 'toolbar' }, [
    select('month', '全部月份', report.months.map((m) => ({ value: m, label: monthLabel(m) })), filter.month),
    select('basis', '', [
      { value: 'attendance', label: '依出席月份 - 實際簽到人次（政府月報用）' },
      { value: 'event', label: '依活動舉辦月份 - 實際報名人次' },
    ], filter.basis, '統計基準'),
    select('programCategory', '全部方案分類', report.programCategories, filter.programCategory),
    select('serviceType', '全部服務類型', report.serviceTypes, filter.serviceType),
    report.subCategories.length
      ? select('subCategory', '全部細分類', report.subCategories, filter.subCategory)
      : null,
    el('button', { class: 'btn btn-ghost', text: '列印', onClick: () => window.print() }),
    downloadLink,
    bureauLink,
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

  // 從活動管理的「按月統計」點過來時，網址會指定要看哪一個月
  const wanted = new URLSearchParams(location.search).get('month') || '';
  if (/^\d{4}-\d{2}$/.test(wanted)) {
    filter.month = wanted;
  } else {
    // 預設看上個月：月報通常是月初交前一個月的數字
    const now = new Date(Date.now() + 8 * 3600 * 1000);
    now.setUTCDate(1);
    now.setUTCMonth(now.getUTCMonth() - 1);
    filter.month = now.toISOString().slice(0, 7);
  }

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
  // 預設的上個月如果沒資料，就退回最近有資料的月份。
  // 網址指定的月份就照著看，就算是空的也不要自作主張跳月
  const report = wanted ? null : await api(`/api/admin/reports?${queryString()}`).catch(() => null);
  if (report && report.totals.activities === 0 && report.months.length
      && !report.months.includes(filter.month)) {
    filter.month = report.months[0];
    await buildAll();
  }
})();

// ---------------------------------------------------------------- 月報其他欄位

/**
 * 月報上那幾塊只能手填的欄位：參訪單位、外部資源連結、會議與教育訓練、
 * FB／IG 數據。
 *
 * 每一塊就是一張可以直接打字的表，按「儲存」把整塊換掉 —— 這些是月底
 * 一次填完的東西，不是一筆一筆長出來的，整塊存最單純：刪掉一列之後
 * 直接按儲存就生效，不用再去點每一列的刪除。
 *
 * 欄位定義由後端給（src/report-extras.js），前後端共用同一份。
 */
function extraBlock(month, kind, spec, rows, expect = null) {
  const blockNotice = el('div', { class: 'notice', hidden: true });
  // 存檔成功之後要重算收合列右邊那句話，函式在下面才定義得出來
  let onSaved = () => {};
  const tbody = el('tbody');
  const totalCells = spec.numbers.map(() => el('td', { class: 'num' }));

  function retotal() {
    spec.numbers.forEach((_, j) => {
      let sum = 0;
      for (const tr of tbody.children) {
        sum += Number(tr.querySelectorAll('input[type="number"]')[j].value) || 0;
      }
      totalCells[j].textContent = sum ? String(sum) : '';
    });
  }

  function addRow(entry) {
    const cells = [];
    if (spec.hasDate) {
      cells.push(el('td', {}, el('input', {
        type: 'date', value: entry?.date || '',
        min: `${month}-01`, max: `${month}-${String(lastDayOf(month)).padStart(2, '0')}`,
        style: 'width:100%;min-width:140px',
      })));
    }
    if (spec.labelName) {
      // 有固定選項的（例如新北市 29 區）用下拉，自己打會打出對不起來的寫法
      if (spec.labelOptions) {
        const pick = el('select', { class: 'row-label', style: 'width:100%;min-width:140px' });
        pick.append(el('option', { value: '', text: `選${spec.labelName}…` }));
        for (const opt of spec.labelOptions) {
          const o = el('option', { value: opt, text: opt });
          if (entry?.label === opt) o.selected = true;
          pick.append(o);
        }
        cells.push(el('td', {}, pick));
      } else {
        cells.push(el('td', {}, el('input', {
          type: 'text', class: 'row-label', value: entry?.label || '',
          placeholder: spec.labelPlaceholder || '', style: 'width:100%;min-width:140px',
        })));
      }
    }
    for (const [j] of spec.numbers.entries()) {
      // num-cell 把數字欄釘成固定窄寬，剩下的寬度留給名稱那一欄 ——
      // 只有「地區＋人次」兩欄的表，不釘的話人次那格會被撐成半個螢幕
      cells.push(el('td', { class: 'num-cell' }, el('input', {
        type: 'number', min: '0', step: '1', placeholder: '0',
        value: entry && entry.numbers[j] ? String(entry.numbers[j]) : '',
        style: 'width:100%;min-width:52px;text-align:right',
      })));
    }
    const tr = el('tr', {}, [
      ...cells,
      spec.single ? null : el('td', {}, el('button', {
        type: 'button', class: 'btn btn-ghost btn-sm', text: '✕', title: '刪掉這一列',
        onClick: () => { tr.remove(); if (!tbody.children.length) addRow(); retotal(); },
      })),
    ].filter(Boolean));
    const onEdit = () => {
      retotal();
      // 最後一列填了東西就自動再長一列（只有一筆的 FB／IG 不用）
      if (!spec.single && tr === tbody.lastElementChild) addRow();
    };
    tr.addEventListener('input', onEdit);
    // 下拉選單只發 change，不發 input
    tr.addEventListener('change', onEdit);
    tbody.append(tr);
    return tr;
  }

  for (const entry of rows) addRow(entry);
  if (spec.single) { if (!rows.length) addRow(); }
  else for (let i = 0; i < (rows.length ? 1 : 3); i += 1) addRow();
  retotal();

  const headCells = [
    spec.hasDate ? el('th', { text: '日期' }) : null,
    spec.labelName ? el('th', { text: spec.labelName }) : null,
    ...spec.numbers.map((n) => el('th', { class: 'num', text: n.replace('\n', ' ') })),
    spec.single ? null : el('th', {}),
  ].filter(Boolean);

  const saveButton = el('button', { type: 'button', class: 'btn btn-sm', text: '儲存' });
  saveButton.addEventListener('click', async () => {
    hideNotice(blockNotice);
    const payload = [];
    for (const tr of tbody.children) {
      const date = spec.hasDate ? tr.querySelector('input[type="date"]').value : '';
      const label = spec.labelName ? tr.querySelector('.row-label').value.trim() : '';
      const numbers = [...tr.querySelectorAll('input[type="number"]')].map((i) => Number(i.value) || 0);
      payload.push({ date, label, numbers });
    }
    saveButton.disabled = true;
    saveButton.textContent = '儲存中…';
    try {
      const result = await api('/api/admin/report-extras', {
        method: 'PUT', body: { month, kind, rows: payload },
      });
      showNotice(blockNotice, 'ok', result.saved ? `已儲存 ${result.saved} 筆。` : '已清空。');
      onSaved();
    } catch (err) {
      showNotice(blockNotice, 'error', err.message);
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = '儲存';
    }
  });

  /*
   * 收合起來只佔一列，右邊直接寫出目前填了什麼（例如「2 筆　15 人次」）。
   * 五塊全部攤開的話這一區會佔掉整頁一半，月底真正要動的通常只有一兩塊。
   */
  const summary = el('span', { class: 'extra-sum' });
  /*
   * 居住地區與年齡是在替補登的人次補個人資料，加起來本來就該等於補登的
   * 總人次。對不起來當場講 —— 等到月報印出來才發現，得整張重填。
   */
  const balance = expect === null ? null : el('p', { class: 'extra-balance' });
  const refreshSummary = () => {
    const filled = [...tbody.children].map((tr) => ({
      label: spec.labelName ? tr.querySelector('.row-label').value.trim() : '',
      date: spec.hasDate ? tr.querySelector('input[type="date"]').value : '',
      numbers: [...tr.querySelectorAll('input[type="number"]')].map((i) => Number(i.value) || 0),
    })).filter((r) => r.label || r.date || r.numbers.some(Boolean));
    summary.textContent = summaryText(kind, spec, filled);
    // 不能叫 empty：全站的 .empty 是「沒有資料」那種虛線方塊，會被套上去
    summary.classList.toggle('extra-sum-none', filled.length === 0);
    if (balance) {
      const got = filled.reduce((n, r) => n + (r.numbers[0] || 0), 0);
      const diff = expect - got;
      balance.textContent = diff === 0
        ? `✓ 加起來 ${got} 人次，跟補登的總人次對得上。`
        : `補登的總人次是 ${expect}，這裡目前是 ${got}，`
          + `${diff > 0 ? `還少 ${diff}` : `多了 ${-diff}`} 人次。`;
      balance.classList.toggle('is-ok', diff === 0);
    }
  };
  tbody.addEventListener('input', refreshSummary);
  tbody.addEventListener('change', refreshSummary);
  refreshSummary();
  onSaved = refreshSummary;

  return el('details', { class: 'extra-row' }, [
    el('summary', {}, [
      el('span', { class: 'extra-name', text: spec.title }),
      summary,
    ]),
    el('div', { class: 'extra-body' }, [
      el('p', { class: 'help', style: 'margin:0 0 8px', text: spec.help }),
      balance,
      blockNotice,
      el('div', { class: 'table-scroll' }, [
        el('table', { class: 'batch-table' }, [
          el('thead', {}, el('tr', {}, headCells)),
          tbody,
          // 只有一筆的 FB／IG 不用小計
          spec.single ? null : el('tfoot', {}, el('tr', {}, [
            el('td', { text: '合計', style: 'font-weight:800' }),
            spec.labelName && spec.hasDate ? el('td', {}) : null,
            ...totalCells,
            el('td', {}),
          ].filter(Boolean))),
        ].filter(Boolean)),
      ]),
      el('div', { class: 'row row-end', style: 'margin-top:10px' }, [saveButton]),
    ]),
  ]);
}

/** 收合那一列右邊那句話：一眼看出這塊填了沒、填了多少。 */
function summaryText(kind, spec, rows) {
  if (!rows.length) return '尚未填寫';
  const sum = (j) => rows.reduce((n, r) => n + (r.numbers[j] || 0), 0);
  const n = (v) => v.toLocaleString('en-US');
  if (spec.single) {
    // FB／IG 只有一列，直接報前兩個數字
    return spec.numbers.slice(0, 2)
      .map((label, j) => `${label.replace(/\(.*/, '')} ${n(sum(j))}`).join('　');
  }
  if (kind === 'meeting') {
    const total = spec.numbers.reduce((acc, _, j) => acc + sum(j), 0);
    return `${rows.length} 位同工　共 ${n(total)} 次`;
  }
  return `${rows.length} 筆　${n(sum(0))} 人次`;
}

/** 整個「月報其他欄位」區塊。沒選月份就填不了（這些都是按月存的）。 */
async function extrasSection(month, manualTotal = 0) {
  if (!month) {
    return {
      extras: el('p', { class: 'help', text: '上面選一個月份才能填這些欄位。' }),
      profile: null,
    };
  }
  const data = await api(`/api/admin/report-extras?month=${encodeURIComponent(month)}`);
  // 五塊收在同一張卡裡，各自可以展開 —— 五張卡並排會把整頁撐得很長
  const extras = el('div', { class: 'card extras-card' });
  for (const [kind, spec] of Object.entries(data.kinds)) {
    extras.append(extraBlock(month, kind, spec, data.entries[kind] || []));
  }

  /*
   * 補登人次的居住地區與年齡，畫在補登表格下面 —— 那裡才是社工想到
   * 「這些人是誰」的地方。身分別不用填，補登時已經分過一般生與原住民。
   *
   * 還沒補登任何人次就不用畫 —— 沒有人次可以分。
   */
  if (!manualTotal) return { extras, profile: null };
  const profile = el('div', { class: 'card extras-card profile-card', style: 'margin-top:14px' });
  for (const [kind, spec] of Object.entries(data.profileKinds || {})) {
    profile.append(extraBlock(month, kind, spec, data.entries[kind] || [], manualTotal));
  }
  return { extras, profile: profile.childElementCount ? profile : null };
}
