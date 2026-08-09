// 後台首頁：統計、新增活動、即將舉行 / 過往活動分頁、刪除活動。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';
import { requireLogin, adminHeader, confirmDelete } from './admin-common.js';

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
 * 「這個活動不只一天？」的設定。
 *
 * 刻意就放在「活動日期」下面 —— 填日期的當下才會想到這件事，
 * 拉到表單最後面反而找不到。兩種常見情況分開講清楚：
 * 連續好幾天（三天兩夜營隊），或每週固定一天（水電課每週三）。
 */
function seriesPanel() {
  const seriesEnd = el('input', { id: 'a_seriesEnd', name: 'seriesEnd', type: 'date' });

  const weekdayBoxes = ['日', '一', '二', '三', '四', '五', '六'].map((label, i) => {
    const box = el('input', { type: 'checkbox', name: 'weekdays', value: String(i) });
    return el('label', { class: 'choice' }, [box, el('span', { text: `週${label}` })]);
  });
  const weekdayField = el('div', { class: 'field', hidden: true }, [
    el('div', { class: 'field-label' }, [
      el('span', { text: '每週上課的星期（可複選）' }),
      el('span', { class: 'help', text: '例：水電課每週三，就勾「週三」' }),
    ]),
    el('div', { class: 'choices' }, weekdayBoxes),
  ]);

  const modes = [
    ['daily', '連續每一天', '例：三天兩夜營隊、連續兩天的工作坊'],
    ['weekly', '每週固定星期', '例：水電課 7-8 月的每週三'],
  ].map(([value, label, hint], i) => {
    const radio = el('input', { type: 'radio', name: 'seriesMode', value });
    radio.checked = i === 0;
    radio.addEventListener('change', () => { weekdayField.hidden = value !== 'weekly'; });
    return el('label', { class: 'choice', title: hint }, [radio, el('span', { text: label })]);
  });

  return el('details', { class: 'editor', style: 'margin:0 0 22px' }, [
    el('summary', { text: '這個活動不只一天？（連續幾天，或每週固定上課）' }),
    el('div', { class: 'editor-body' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'a_seriesEnd' }, [
          el('span', { text: '最後一天' }),
          el('span', { class: 'help', text: '從上面的「活動日期（第一場）」排到這一天' }),
        ]),
        seriesEnd,
      ]),
      el('div', { class: 'field' }, [
        el('div', { class: 'field-label', text: '上課方式' }),
        el('div', { class: 'choices' }, modes),
      ]),
      weekdayField,
    ]),
  ]);
}

/**
 * 產生活動表單。
 * 除了一般欄位，最後多一個「開放報名」開關，讓工作人員可以隨時
 * 暫停報名（例如名額還沒確定），或把匯入進來的活動重新開放。
 */
function activityFormFields(values = {}) {
  const grid = el('div', { class: 'grid-2' });
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
    grid.append(el('div', { class: `field${field.span ? ' span-2' : ''}` }, [
      fieldLabel(field, id),
      input,
    ]));

    // 活動日期那一列排完（日期 + 時間），緊接著就是多天活動的設定
    if (field.key === 'eventTime') grid.append(el('div', { class: 'span-2' }, seriesPanel()));
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
  grid.append(el('div', { class: 'field span-2' }, [
    el('label', { class: 'choice', style: 'display:inline-flex' }, [
      openBox, el('span', { text: '開放報名' }),
    ]),
    el('p', { class: 'help' },
      '取消勾選就會暫停報名，活動仍然看得到但無法送出。活動日期過了會自動停止報名。'),
  ]));
  return grid;
}

/** 把表單資料轉成 API 需要的格式（checkbox 沒勾時 FormData 不會有這個鍵）。 */
function readActivityForm(form) {
  const data = new FormData(form);
  const body = Object.fromEntries(data);
  body.closed = !form.querySelector('[name="registrationOpen"]').checked;
  delete body.registrationOpen;
  // 「連續每一天」不帶星期（後端會排出期間內的每一天），
  // 「每週固定星期」才把勾選的星期送過去
  const mode = data.get('seriesMode');
  body.weekdays = mode === 'weekly' ? data.getAll('weekdays').map(Number) : [];
  delete body.seriesMode;
  if (!body.seriesEnd) { delete body.seriesEnd; delete body.weekdays; }
  return body;
}

function createPanel() {
  const form = el('form', { novalidate: true });
  form.append(activityFormFields());
  const button = el('button', { class: 'btn', type: 'submit', text: '建立活動' });
  form.append(el('div', { class: 'row row-end' }, [button]));

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    button.disabled = true;
    try {
      const { activity } = await api('/api/admin/activities', {
        method: 'POST', body: readActivityForm(form),
      });
      form.reset();
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
  const dialog = el('dialog');
  const form = el('form', {}, activityFormFields(activity));
  const save = el('button', { class: 'btn', text: '儲存' });

  const close = () => { dialog.close(); dialog.remove(); };
  save.addEventListener('click', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      await api(`/api/admin/activities/${activity.id}`, {
        method: 'PATCH', body: readActivityForm(form),
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
  if (activity.closed) return el('span', { class: 'badge badge-closed', text: '手動關閉' });
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
    el('td', { class: 'num', text: seats }),
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
