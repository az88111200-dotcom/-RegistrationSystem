// 後台首頁：統計、新增活動、即將舉行 / 過往活動分頁、刪除活動。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';
import { requireLogin, adminHeader, confirmDelete } from './admin-common.js';
import {
  datesByPattern, normalizeDates, describeDates, shortDate, WEEKDAY_NAMES, MAX_SESSIONS,
} from './schedule.js';

let activities = [];
let scope = 'upcoming';

const notice = el('div', { class: 'notice', hidden: true });
const listSlot = el('div');
const statSlot = el('div', { class: 'stat-grid' });

// ---------------------------------------------------------------- 新增活動

const ACTIVITY_FORM_FIELDS = [
  { key: 'title', label: '活動名稱', type: 'text', required: true, span: true },
  { key: 'eventDate', label: '活動日期（第一場）', type: 'date', required: true, help: '連續性課程請填第一堂的日期' },
  { key: 'eventTime', label: '活動時間', type: 'text', placeholder: '例：08:00-19:00' },
  { key: 'registrationDeadline', label: '報名截止日', type: 'date', help: '留白代表到活動當天都能報名' },
  { key: 'capacity', label: '名額上限', type: 'number', placeholder: '0 = 不限名額' },
  {
    key: 'waitlistCapacity', label: '候補名額上限', type: 'number', placeholder: '0 = 不限',
    help: '額滿後還能排幾個候補',
  },
  { key: 'location', label: '活動地點', type: 'text', placeholder: '例：新北市貢寮區 龍門舊社沙灘' },
  { key: 'gatheringPlace', label: '集合地點', type: 'text', placeholder: '例：新北市泰山區明志路一段350號' },
  { key: 'summary', label: '一句話簡介', type: 'text', span: true, help: '會顯示在活動列表的卡片上' },
  { key: 'description', label: '詳細活動說明', type: 'textarea', span: true, help: '可以分行，會照原樣顯示（例如當日流程）' },
  { key: 'contact', label: '聯絡資訊', type: 'text', span: true, placeholder: '例：洽詢電話 02-2297-7113 王社工' },
];

/**
 * 工作人員用的分類，做月報統計會用到。
 * 這三個欄位不會顯示在前台，少年看不到。
 */
const CATEGORY_FIELDS = [
  {
    key: 'programCategory', label: '方案分類', type: 'select',
    options: ['社區與親子培力方案', '微創實驗方案'],
  },
  {
    key: 'serviceType', label: '服務類型', type: 'select',
    options: ['團體工作', '方案服務', '社區工作'],
  },
  {
    key: 'subCategory', label: '細分類', type: 'text', span: true,
    placeholder: '自由填寫，例：親子共學、青少年培力團體',
    help: '月報可以用這個細分類篩選，同一類的活動請填一樣的名稱',
  },
];

/**
 * 欄位標題。說明文字跟標題排同一行（粗體標題、淡色說明），
 * 輸入框才會整齊地排在下面一行，左右兩欄也不會被說明推歪。
 */
function fieldLabel(field, id) {
  return el('label', { for: id }, [
    el('span', { text: field.label }),
    field.required ? el('span', { class: 'req', text: '*' }) : null,
    field.help ? el('span', { class: 'help', text: field.help }) : null,
  ]);
}

/**
 * 上課日期的挑選器。
 *
 * 排課的實際情況太多樣 —— 三天兩夜營隊、每週三的水電課、隔週的成長團體，
 * 中間還要跳過中秋節、月底補一堂。所以這裡不做成「選一種模式」，
 * 而是「一份日期清單」：規律的部分用快速排課一次帶進來，
 * 例外的部分再一天一天加減。最後送出去的就是這串日期本身。
 *
 * 放在「活動日期」正下方，是因為填日期的當下才會想到這件事。
 */
function schedulePanel(firstDateInput, timeInput, initialSessions = []) {
  // 第一場（也就是活動日期）永遠在清單裡，其餘存在這裡
  let extra = new Set(normalizeDates(initialSessions.map((s) => s.date)));

  // 只有「這一堂時間跟別堂不一樣」的日期才會記在這裡，其餘留白＝照活動時間
  const times = new Map();
  for (const s of initialSessions) {
    if (s.startTime || s.endTime) {
      times.set(s.date, { startTime: s.startTime || '', endTime: s.endTime || '' });
    }
  }

  const chips = el('div', { class: 'chip-list' });
  const summary = el('p', { class: 'help', style: 'margin:0 0 10px' });
  const hint = el('p', { class: 'help' });

  const firstDate = () => firstDateInput.value;
  const allDates = () => normalizeDates([firstDate(), ...extra]);

  const endInput = el('input', { id: 'a_seriesEnd', type: 'date', max: '2100-12-31' });
  const addInput = el('input', { type: 'date', max: '2100-12-31', 'aria-label': '另外加一天' });

  const patterns = [
    ['daily', '連續每一天', '例：三天兩夜營隊'],
    ['weekly', '每週', '例：水電課每週三'],
    ['biweekly', '隔週', '例：隔週三的成長團體'],
  ];
  let pattern = 'weekly';

  const weekdayBoxes = WEEKDAY_NAMES.map((label, i) => {
    const box = el('input', { type: 'checkbox', value: String(i) });
    return el('label', { class: 'choice' }, [box, el('span', { text: `週${label}` })]);
  });
  const weekdayField = el('div', { class: 'field' }, [
    el('div', { class: 'field-label' }, [
      el('span', { text: '星期幾上課（可複選）' }),
      el('span', { class: 'help', text: '不勾就照「活動日期」那天的星期' }),
    ]),
    el('div', { class: 'choices' }, weekdayBoxes),
  ]);

  const patternChoices = patterns.map(([value, label, tip]) => {
    const radio = el('input', { type: 'radio', name: 'schedulePattern', value });
    radio.checked = value === pattern;
    radio.addEventListener('change', () => {
      pattern = value;
      weekdayField.hidden = value === 'daily';
    });
    return el('label', { class: 'choice', title: tip }, [radio, el('span', { text: label })]);
  });

  // ---- 各堂時間：預設每堂都一樣，勾起來才逐堂填
  const timeRows = el('div', { class: 'session-times' });
  const perSessionBox = el('input', { type: 'checkbox' });
  const perSessionField = el('div', { class: 'field', style: 'margin-top:16px' }, [
    el('div', { class: 'choices' }, [
      el('label', { class: 'choice' }, [
        perSessionBox,
        el('span', { text: '每堂時間不一樣' }),
      ]),
    ]),
    el('p', { class: 'help', style: 'margin:6px 0 0' },
      '例如第一堂 09:00-12:00、第二堂 14:00-17:00。'
      + '留白的那一堂就照上面的「活動時間」，只有不一樣的才要填。'),
    timeRows,
  ]);
  perSessionBox.addEventListener('change', () => {
    if (!perSessionBox.checked) {
      times.clear();
    } else if (!times.size) {
      // 先把「活動時間」填進每一堂，工作人員只要改不一樣的那幾堂就好
      const m = /^\s*(\d{1,2}:\d{2})\s*[-~—－至]\s*(\d{1,2}:\d{2})\s*$/.exec(timeInput.value || '');
      if (m) {
        const pad = (t) => (t.length === 4 ? `0${t}` : t);
        for (const date of allDates()) {
          times.set(date, { startTime: pad(m[1]), endTime: pad(m[2]) });
        }
      }
    }
    redrawTimes();
  });

  function redrawTimes() {
    const dates = allDates();
    // 單日活動沒有「每堂不一樣」可言，這個區塊就不用出現
    perSessionField.hidden = dates.length < 2;
    timeRows.hidden = !perSessionBox.checked;
    if (!perSessionBox.checked || dates.length < 2) {
      timeRows.innerHTML = '';
      return;
    }
    timeRows.innerHTML = '';
    for (const date of dates) {
      const current = times.get(date) || { startTime: '', endTime: '' };
      const start = el('input', { type: 'time', 'aria-label': `${date} 開始時間` });
      const end = el('input', { type: 'time', 'aria-label': `${date} 結束時間` });
      start.value = current.startTime;
      end.value = current.endTime;
      const save = () => {
        if (start.value || end.value) {
          times.set(date, { startTime: start.value, endTime: end.value });
        } else {
          times.delete(date);
        }
      };
      start.addEventListener('change', save);
      end.addEventListener('change', save);
      timeRows.append(el('div', { class: 'session-time-row' }, [
        el('span', { class: 'session-time-date', text: shortDate(date) }),
        start,
        el('span', { class: 'help', style: 'margin:0', text: '－' }),
        end,
      ]));
    }
  }

  function redraw() {
    const dates = allDates();
    chips.innerHTML = '';
    for (const date of dates) {
      const isFirst = date === firstDate();
      chips.append(el('span', { class: `chip${isFirst ? ' chip-fixed' : ''}` }, [
        el('span', { text: shortDate(date) }),
        isFirst
          // 第一場就是上面的「活動日期」，要改請改那一格，才不會兩邊打架
          ? el('span', { class: 'chip-note', text: '第一場' })
          : el('button', {
            type: 'button', class: 'chip-x', title: `移除 ${date}`, text: '×',
            onClick: () => { extra.delete(date); times.delete(date); redraw(); },
          }),
      ]));
    }
    summary.textContent = dates.length > 1
      ? `已排定 ${describeDates(dates)}`
      : '目前是單日活動。要變成連續性課程，用下面的快速排課，或一天一天加。';
    redrawTimes();
  }

  /** 送給後端的場次清單：日期，加上這一堂自己的時間（留白＝照活動時間）。 */
  function sessions() {
    return allDates().map((date) => {
      const t = (perSessionBox.checked && times.get(date)) || {};
      return { date, startTime: t.startTime || '', endTime: t.endTime || '' };
    });
  }

  function quickFill() {
    const start = firstDate();
    if (!start) {
      hint.textContent = '請先填上面的「活動日期（第一場）」。';
      return;
    }
    if (!endInput.value) {
      hint.textContent = '請填「排到哪一天」。';
      return;
    }
    if (endInput.value < start) {
      hint.textContent = '「排到哪一天」不能早於活動日期。';
      return;
    }
    const weekdays = weekdayBoxes
      .filter((w) => w.querySelector('input').checked)
      .map((w) => Number(w.querySelector('input').value));
    const dates = datesByPattern(start, endInput.value, pattern, weekdays);
    if (!dates.length) {
      hint.textContent = '這段期間內沒有符合的日期，請確認星期選對了。';
      return;
    }
    if (dates.length > MAX_SESSIONS) {
      hint.textContent = `這樣會排出超過 ${MAX_SESSIONS} 堂，請把期間縮短一點。`;
      return;
    }
    // 快速排課是「加進來」，不會蓋掉已經手動加的日期
    extra = new Set(normalizeDates([...extra, ...dates]));
    hint.textContent = `已排入 ${dates.length} 個日期。不上課的那幾天，按 × 拿掉就好。`;
    redraw();
  }

  function addOne() {
    if (!addInput.value) return;
    extra.add(addInput.value);
    extra = new Set(normalizeDates([...extra]));
    addInput.value = '';
    hint.textContent = '';
    redraw();
  }

  // 已經有某幾堂時間不一樣的話，打開表單就先勾起來，不然會以為時間不見了
  perSessionBox.checked = new Set(
    initialSessions.map((s) => `${s.startTime || ''}-${s.endTime || ''}`),
  ).size > 1;

  firstDateInput.addEventListener('change', redraw);
  redraw();

  const panel = el('details', { class: 'editor schedule', style: 'margin:0 0 22px' }, [
    el('summary', { text: '上課日期與時間（連續幾天、每週、隔週，或自己挑）' }),
    el('div', { class: 'editor-body' }, [
      summary,
      chips,
      perSessionField,
      el('div', { class: 'field', style: 'margin-top:16px' }, [
        el('div', { class: 'field-label' }, [
          el('span', { text: '快速排課' }),
          el('span', { class: 'help', text: '先照規律排一輪，再手動加減' }),
        ]),
        el('div', { class: 'choices', style: 'margin-bottom:10px' }, patternChoices),
        el('div', { class: 'row' }, [
          el('span', { class: 'help', style: 'margin:0', text: '排到' }),
          endInput,
          el('button', { type: 'button', class: 'btn btn-sm', text: '排入日期', onClick: quickFill }),
        ]),
      ]),
      weekdayField,
      el('div', { class: 'field', style: 'margin-bottom:0' }, [
        el('div', { class: 'field-label' }, [
          el('span', { text: '另外加一天' }),
          el('span', { class: 'help', text: '補課、加開場次用' }),
        ]),
        el('div', { class: 'row' }, [
          addInput,
          el('button', { type: 'button', class: 'btn btn-ghost btn-sm', text: '加入', onClick: addOne }),
        ]),
      ]),
      hint,
    ]),
  ]);

  // 這個活動已經是連續性課程的話，打開表單就先展開，免得以為日期不見了
  if (extra.size) panel.open = true;

  return { panel, sessions };
}

/**
 * 產生活動表單。
 * 除了一般欄位，最後多一個「開放報名」開關，讓工作人員可以隨時
 * 暫停報名（例如名額還沒確定），或把匯入進來的活動重新開放。
 */
function activityFormFields(values = {}, sessions = []) {
  const grid = el('div', { class: 'grid-2' });
  let schedule = null;
  let dateInput = null;
  let timeInput = null;

  for (const field of ACTIVITY_FORM_FIELDS) {
    const id = `a_${field.key}`;
    const input = field.type === 'textarea'
      ? el('textarea', { id, name: field.key, placeholder: field.placeholder || '' })
      : el('input', {
        id, name: field.key, type: field.type,
        placeholder: field.placeholder || '', min: field.type === 'number' ? '0' : null,
      });
    input.value = values[field.key] ?? '';
    if (field.required) input.required = true;
    if (field.key === 'eventDate') dateInput = input;
    if (field.key === 'eventTime') timeInput = input;
    grid.append(el('div', { class: `field${field.span ? ' span-2' : ''}` }, [
      fieldLabel(field, id),
      input,
    ]));

    // 活動日期那一列排完（日期 + 時間），緊接著就是上課日期的設定
    if (field.key === 'eventTime') {
      schedule = schedulePanel(dateInput, timeInput, sessions);
      grid.append(el('div', { class: 'span-2' }, schedule.panel));
    }
  }

  // 分類區塊：跟活動內容分開，讓工作人員一眼看出這段前台看不到
  grid.append(el('div', { class: 'field span-2' }, [
    el('div', { class: 'field-label', style: 'color:var(--leaf-700)' }, '工作人員分類（前台不顯示，月報統計用）'),
  ]));
  for (const field of CATEGORY_FIELDS) {
    const id = `a_${field.key}`;
    let input;
    if (field.type === 'select') {
      input = el('select', { id, name: field.key });
      input.append(el('option', { value: '', text: '（未分類）' }));
      for (const opt of field.options) {
        const o = el('option', { value: opt, text: opt });
        if (values[field.key] === opt) o.selected = true;
        input.append(o);
      }
    } else {
      input = el('input', { id, name: field.key, type: 'text', placeholder: field.placeholder || '' });
      input.value = values[field.key] ?? '';
    }
    grid.append(el('div', { class: `field${field.span ? ' span-2' : ''}` }, [
      fieldLabel(field, id),
      input,
    ]));
  }

  const openBox = el('input', { type: 'checkbox', name: 'registrationOpen' });
  openBox.checked = !values.closed;
  const waitBox = el('input', { type: 'checkbox', name: 'waitlistOpen' });
  waitBox.checked = values.waitlistOpen !== false;
  const unlistedBox = el('input', { type: 'checkbox', name: 'unlisted' });
  unlistedBox.checked = values.unlisted === true;
  grid.append(el('div', { class: 'field span-2' }, [
    el('div', { class: 'choices' }, [
      el('label', { class: 'choice' }, [openBox, el('span', { text: '開放報名' })]),
      el('label', { class: 'choice' }, [waitBox, el('span', { text: '額滿後開放候補' })]),
      el('label', { class: 'choice' }, [unlistedBox, el('span', { text: '不對外公開（封閉式團體）' })]),
    ]),
    el('p', { class: 'help' },
      '取消「開放報名」就會暫停報名，活動仍然看得到但無法送出；活動日期過了會自動停止報名。'
      + '「開放候補」打勾時，額滿之後少年還是可以報名，會排進候補名單，'
      + '有人取消時系統會自動遞補第一位。'),
    el('p', { class: 'help' },
      '「不對外公開」勾起來，這個活動就不會出現在前台的活動清單裡，'
      + '只有拿到報名連結的人進得去 —— 封閉式團體用這個。'
      + '簽到、出席與月報人次都照常計算。'),
  ]));
  // 送出時要問挑選器現在有哪些日期，所以把它掛在表單節點上
  grid.getSessions = schedule ? schedule.sessions : () => [];
  return grid;
}

/** 把表單資料轉成 API 需要的格式（checkbox 沒勾時 FormData 不會有這個鍵）。 */
function readActivityForm(form, getSessions) {
  const data = new FormData(form);
  const body = Object.fromEntries(data);
  body.closed = !form.querySelector('[name="registrationOpen"]').checked;
  body.waitlistOpen = form.querySelector('[name="waitlistOpen"]').checked;
  body.unlisted = form.querySelector('[name="unlisted"]').checked;
  delete body.registrationOpen;
  // 場次一律送完整清單（單日活動就是一場），後端照收，
  // 不用再猜是哪一種排課模式。時間留白的那一堂會沿用活動時間。
  body.sessions = getSessions();
  return body;
}

function createPanel() {
  const form = el('form', { novalidate: true });
  let fields = activityFormFields();
  form.append(fields);
  const button = el('button', { class: 'btn', type: 'submit', text: '建立活動' });
  form.append(el('div', { class: 'row row-end' }, [button]));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      const { activity } = await api('/api/admin/activities', {
        method: 'POST', body: readActivityForm(form, fields.getSessions),
      });
      // form.reset() 清不掉挑選器裡的日期，整組欄位重建才乾淨
      form.reset();
      const fresh = activityFormFields();
      fields.replaceWith(fresh);
      fields = fresh;
      details.open = false;
      showNotice(notice, 'ok',
        `已建立活動「${activity.title}」，報名網址：${location.origin}/activity/${activity.slug}`);
      await load();
    } catch (err) {
      showNotice(notice, 'error', err.message);
    } finally {
      button.disabled = false;
    }
  });

  const details = el('details', { class: 'editor' }, [
    el('summary', { text: '新增活動' }),
    el('div', { class: 'editor-body' }, form),
  ]);
  return details;
}

// ---------------------------------------------------------------- 編輯活動

async function openEditor(activity) {
  // 編輯時要先把現有的場次讀回來，挑選器才知道目前排了哪幾天、各堂幾點
  let sessions = [];
  try {
    const data = await api(`/api/admin/activities/${activity.id}/sessions`);
    sessions = data.sessions;
  } catch {
    // 讀不到就當單日活動處理，至少表單還開得起來
  }

  const dialog = el('dialog');
  const fields = activityFormFields(activity, sessions);
  const form = el('form', {}, fields);
  const save = el('button', { class: 'btn', text: '儲存' });

  const close = () => { dialog.close(); dialog.remove(); };
  save.addEventListener('click', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await api(`/api/admin/activities/${activity.id}`, {
        method: 'PATCH', body: readActivityForm(form, fields.getSessions),
      });
      close();
      showNotice(notice, 'ok', '活動已更新。');
      await load();
    } catch (err) {
      alert(err.message);
      save.disabled = false;
    }
  });

  dialog.append(
    el('div', { class: 'dlg-head', text: '編輯活動' }),
    el('div', { class: 'dlg-body' }, form),
    el('div', { class: 'dlg-foot' }, [
      el('button', { class: 'btn btn-ghost', text: '取消', onClick: (e) => { e.preventDefault(); close(); } }),
      save,
    ]),
  );
  dialog.addEventListener('cancel', close);
  document.body.append(dialog);
  dialog.showModal();
}

// ---------------------------------------------------------------- 活動列表

function statusBadge(activity) {
  if (activity.isPast) return el('span', { class: 'badge badge-past', text: '已結束' });
  // 不公開要優先標出來，工作人員一眼就知道這個活動前台看不到
  if (activity.unlisted && activity.isOpen) {
    return el('span', { class: 'badge badge-closed', text: '不公開・進行中' });
  }
  if (activity.closed) return el('span', { class: 'badge badge-closed', text: '手動關閉' });
  if (activity.isFull && activity.acceptingWaitlist) {
    return el('span', { class: 'badge badge-wait', text: '額滿・候補中' });
  }
  if (activity.isFull) return el('span', { class: 'badge badge-full', text: '已額滿' });
  if (!activity.isOpen) return el('span', { class: 'badge badge-closed', text: '已截止' });
  return el('span', { class: 'badge badge-open', text: '報名中' });
}

function activityRow(activity) {
  const seats = activity.capacity > 0
    ? `${activity.registrationCount} / ${activity.capacity}`
    : String(activity.registrationCount);

  return el('tr', {}, [
    el('td', { class: 'wrap-cell' }, [
      el('a', {
        href: `/admin/activity/${activity.id}`,
        style: 'font-weight:700',
        text: activity.title,
      }),
      el('div', { class: 'help', style: 'margin:2px 0 0' }, [
        el('a', {
          href: `/activity/${encodeURIComponent(activity.slug)}`,
          target: '_blank', rel: 'noopener',
          text: `報名網址 /activity/${activity.slug} ↗`,
        }),
        el('button', {
          class: 'btn btn-ghost btn-sm', style: 'margin-left:8px;padding:2px 8px',
          text: '複製連結',
          onClick: async (event) => {
            const url = `${location.origin}/activity/${encodeURIComponent(activity.slug)}`;
            try {
              await navigator.clipboard.writeText(url);
              event.target.textContent = '已複製 ✓';
            } catch {
              // 沒有剪貼簿權限（例如非 https）時，改用提示讓工作人員自己複製
              prompt('請複製這個報名連結：', url);
            }
            setTimeout(() => { event.target.textContent = '複製連結'; }, 1600);
          },
        }),
      ]),
    ]),
    el('td', { text: formatDate(activity.eventDate) }),
    el('td', { class: 'wrap-cell' }, [
      activity.programCategory || activity.serviceType || activity.subCategory
        ? el('div', { class: 'pill-list' }, [
          activity.programCategory ? el('span', { class: 'pill', text: activity.programCategory }) : null,
          activity.serviceType ? el('span', { class: 'pill', text: activity.serviceType }) : null,
          activity.subCategory ? el('span', { class: 'pill', text: activity.subCategory }) : null,
        ].filter(Boolean))
        : el('span', { class: 'help', text: '未分類' }),
    ]),
    el('td', {}, statusBadge(activity)),
    el('td', { class: 'num' }, [
      el('span', { text: seats }),
      activity.waitlistCount > 0
        ? el('div', { class: 'help', style: 'margin:0' , text: `候補 ${activity.waitlistCount}` })
        : null,
    ]),
    el('td', {}, [
      el('div', { class: 'row', style: 'flex-wrap:nowrap' }, [
        el('a', { class: 'btn btn-ghost btn-sm', href: `/admin/activity/${activity.id}`, text: '名單' }),
        el('a', {
          class: 'btn btn-ghost btn-sm',
          href: `/api/admin/activities/${activity.id}/export.csv`,
          text: '下載',
        }),
        el('button', {
          class: 'btn btn-ghost btn-sm', text: '編輯',
          onClick: () => openEditor(activity),
        }),
        el('button', {
          class: 'btn btn-danger btn-sm', text: '刪除',
          onClick: async () => {
            const ok = await confirmDelete({
              title: '刪除活動',
              message: `確定要刪除「${activity.title}」嗎？\n這個活動的 ${activity.registrationCount} 筆報名紀錄也會一起刪掉，無法復原。\n（學生的基本資料會保留在學生資料總集裡）`,
              confirmWord: '刪除',
            });
            if (!ok) return;
            try {
              const result = await api(`/api/admin/activities/${activity.id}`, { method: 'DELETE' });
              showNotice(notice, 'ok',
                `已刪除「${result.deleted}」，同時移除 ${result.removedRegistrations} 筆報名紀錄。`);
              await load();
            } catch (err) {
              showNotice(notice, 'error', err.message);
            }
          },
        }),
      ]),
    ]),
  ]);
}

function renderList() {
  const rows = activities.filter((a) => (scope === 'past' ? a.isPast : !a.isPast));
  listSlot.innerHTML = '';

  if (!rows.length) {
    listSlot.append(el('div', { class: 'empty' }, [
      el('strong', { text: scope === 'past' ? '還沒有過往活動' : '目前沒有即將舉行的活動' }),
      scope === 'past' ? '活動日期過了就會自動移到這裡。' : '用上面的「新增活動」建立第一個活動吧。',
    ]));
    return;
  }

  listSlot.append(el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '活動名稱' }),
        el('th', { text: '活動日期' }),
        el('th', { text: '分類' }),
        el('th', { text: '狀態' }),
        el('th', { class: 'num', text: '報名人數' }),
        el('th', { text: '操作' }),
      ])),
      el('tbody', {}, rows.map(activityRow)),
    ]),
  ]));
}

function renderTabs() {
  const tabs = el('div', { class: 'tabs' });
  const make = (value, label) => el('button', {
    class: 'tab', 'aria-selected': scope === value ? 'true' : 'false', text: label,
    onClick: () => { scope = value; renderTabs2(); renderList(); },
  });
  tabs.append(
    make('upcoming', `即將舉行（${activities.filter((a) => !a.isPast).length}）`),
    make('past', `過往活動（${activities.filter((a) => a.isPast).length}）`),
  );
  return tabs;
}

let tabsSlot;
function renderTabs2() {
  tabsSlot.innerHTML = '';
  tabsSlot.append(renderTabs());
}

// ---------------------------------------------------------------- 載入

async function load() {
  const [{ activities: list }, stat] = await Promise.all([
    api('/api/admin/activities'),
    api('/api/admin/stats'),
  ]);
  activities = list;

  statSlot.innerHTML = '';
  const cards = [
    [stat.upcomingCount, '即將舉行的活動'],
    [stat.pastCount, '過往活動'],
    [stat.studentCount, '建檔學生人數'],
    [stat.registrationCount, '累計報名人次'],
  ];
  for (const [n, label] of cards) {
    statSlot.append(el('div', { class: 'stat' }, [
      el('div', { class: 'n', text: String(n) }),
      el('div', { class: 'l', text: label }),
    ]));
  }
  renderTabs2();
  renderList();
}

(async () => {
  await requireLogin();
  const root = $('#root');
  root.innerHTML = '';
  tabsSlot = el('div');

  root.append(
    adminHeader('/admin'),
    el('main', { class: 'wrap-wide' }, [
      el('div', { class: 'page-head' }, [
        el('h1', { text: '活動管理' }),
        el('p', { text: '每個活動都有自己的報名子頁面。活動日期一過，就會自動移到「過往活動」。' }),
      ]),
      notice,
      // 簽到 QR 常常要找，放在最上面一眼看得到
      el('div', { class: 'notice notice-info' }, [
        el('span', { text: '現場簽到：全部活動共用一張 QR Code，' }),
        el('a', { href: '/admin/checkin', style: 'font-weight:700', text: '按這裡列印簽到 QR →' }),
      ]),
      statSlot,
      createPanel(),
      tabsSlot,
      listSlot,
    ]),
  );

  try {
    hideNotice(notice);
    await load();
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
})();
