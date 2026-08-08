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
  { key: 'eventDate', label: '活動日期', type: 'date', required: true, help: '過了這一天，活動會自動移到「過往活動」' },
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
      el('label', { for: id }, [
        el('span', { text: field.label }),
        field.required ? el('span', { class: 'req', text: '*' }) : null,
      ]),
      field.help ? el('p', { class: 'help', text: field.help }) : null,
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
  const body = Object.fromEntries(new FormData(form));
  body.closed = !form.querySelector('[name="registrationOpen"]').checked;
  delete body.registrationOpen;
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
