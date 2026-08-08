// 後台：單一活動的報名名單。可搜尋、刪除某人的報名、下載 CSV。

import { api, $, el, formatDate, toRoc, showNotice, hideNotice, displayValue } from './common.js';
import { requireLogin, adminHeader, confirmDelete } from './admin-common.js';

const activityId = decodeURIComponent(
  location.pathname.replace(/^\/admin\/activity\//, '').replace(/\/$/, ''),
);

let activity = null;
let roster = [];
let query = '';

const notice = el('div', { class: 'notice', hidden: true });
const tableSlot = el('div');
const headSlot = el('div');

/** 名單表格要顯示哪些欄位（完整資料在展開的詳細資料裡）。 */
const COLUMNS = [
  { key: 'seq', label: '#', cls: 'num' },
  { key: 'name', label: '姓名' },
  { key: 'gender', label: '性別' },
  { key: 'ageAtEvent', label: '年齡' },
  { key: 'idNumber', label: '身份證字號' },
  { key: 'school', label: '就讀學校' },
  { key: 'grade', label: '年級' },
  { key: 'district', label: '居住區域' },
  { key: 'mobile', label: '少年手機' },
  { key: 'guardianName', label: '監護人' },
  { key: 'guardianPhone', label: '監護人電話' },
  { key: 'identityType', label: '身分別' },
  { key: 'familyStatus', label: '特殊家庭狀況' },
  { key: 'registeredAt', label: '報名時間' },
];

function matches(row) {
  if (!query) return true;
  const q = query.toLowerCase();
  return [
    row.name, row.idNumber, row.school, row.district, row.mobile, row.homePhone,
    row.guardianName, row.guardianPhone, row.lineId, row.email, row.grade,
    displayValue(row.familyStatus), row.source, displayValue(row.reasons),
  ].join(' ').toLowerCase().includes(q);
}

/** 點姓名展開這個人這次報名填的完整內容。 */
function openDetail(row) {
  const dialog = el('dialog');
  const rows = [
    ['報名時間', row.registeredAt],
    ['少年姓名', row.name],
    ['性別', row.gender],
    ['活動當天年齡', row.ageAtEvent],
    ['身份證字號', row.idNumber],
    ['身分別', row.identityType],
    ['特殊家庭狀況', displayValue(row.familyStatus)],
    ['出生年月日', `${row.birthDate}（民國 ${toRoc(row.birthDate)}）`],
    ['就讀學校 / 年級', `${row.school}　${row.grade}`],
    ['學籍/居住區域', row.district],
    ['居住地址', row.address],
    ['住家電話', row.homePhone],
    ['少年手機', row.mobile],
    ['LINE ID', row.lineId],
    ['Email', row.email],
    ['監護人姓名', row.guardianName],
    ['監護人身分證號', row.guardianIdNumber],
    ['監護人出生年月日', `${row.guardianBirthDate}（民國 ${toRoc(row.guardianBirthDate)}）`],
    ['監護人國籍', row.guardianNationality],
    ['與學生關係', row.guardianRelation],
    ['監護人電話', row.guardianPhone],
    ['從哪裡得知此活動', row.source],
    ['報名原因', displayValue(row.reasons)],
    ['全程參與承諾', displayValue(row.commitment)],
  ];

  const noteInput = el('textarea', { style: 'min-height:70px', placeholder: '工作人員備註（例：素食、需要接送）' });
  noteInput.value = row.note || '';

  const save = el('button', { class: 'btn', text: '儲存備註' });
  const close = () => { dialog.close(); dialog.remove(); };

  save.addEventListener('click', async () => {
    save.disabled = true;
    try {
      await api(`/api/admin/registrations/${row.registrationId}`, {
        method: 'PATCH', body: { note: noteInput.value },
      });
      close();
      await load();
    } catch (err) {
      alert(err.message);
      save.disabled = false;
    }
  });

  dialog.append(
    el('div', { class: 'dlg-head', text: `${row.name} 的報名資料` }),
    el('div', { class: 'dlg-body' }, [
      el('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [
        el('dt', { text: k }), el('dd', { text: v || '—' }),
      ])),
      el('div', { class: 'field', style: 'margin-top:16px' }, [
        el('label', { text: '備註' }), noteInput,
      ]),
    ]),
    el('div', { class: 'dlg-foot' }, [
      el('button', { class: 'btn btn-ghost', text: '關閉', onClick: close }),
      save,
    ]),
  );
  dialog.addEventListener('cancel', close);
  document.body.append(dialog);
  dialog.showModal();
}

async function removeRegistration(row) {
  const ok = await confirmDelete({
    title: '刪除報名',
    message: `確定要把「${row.name}」從「${activity.title}」的名單中刪除嗎？\n這位少年在學生資料總集裡的基本資料會保留。`,
    confirmWord: row.name,
    danger: '刪除這筆報名',
  });
  if (!ok) return;
  try {
    await api(`/api/admin/registrations/${row.registrationId}`, { method: 'DELETE' });
    showNotice(notice, 'ok', `已刪除 ${row.name} 的報名。`);
    await load();
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
}

function renderTable() {
  const rows = roster.filter(matches);
  tableSlot.innerHTML = '';

  if (!roster.length) {
    tableSlot.append(el('div', { class: 'empty' }, [
      el('strong', { text: '還沒有人報名' }),
      '把活動網址分享出去吧。',
    ]));
    return;
  }
  if (!rows.length) {
    tableSlot.append(el('div', { class: 'empty' }, [
      el('strong', { text: '沒有符合的報名者' }), `找不到包含「${query}」的資料。`,
    ]));
    return;
  }

  tableSlot.append(el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        ...COLUMNS.map((c) => el('th', { class: c.cls || '', text: c.label })),
        el('th', { text: '操作' }),
      ])),
      el('tbody', {}, rows.map((row) => el('tr', {}, [
        ...COLUMNS.map((c) => {
          if (c.key === 'name') {
            return el('td', {}, el('a', {
              href: '#', style: 'font-weight:700',
              text: row.name,
              onClick: (e) => { e.preventDefault(); openDetail(row); },
            }));
          }
          return el('td', { class: c.cls || '', text: displayValue(row[c.key]) || '—' });
        }),
        el('td', {}, el('div', { class: 'row', style: 'flex-wrap:nowrap' }, [
          el('button', { class: 'btn btn-ghost btn-sm', text: '詳細', onClick: () => openDetail(row) }),
          el('button', { class: 'btn btn-danger btn-sm', text: '刪除', onClick: () => removeRegistration(row) }),
        ])),
      ]))),
    ]),
  ]));
}

function renderHead() {
  headSlot.innerHTML = '';
  const seats = activity.capacity > 0
    ? `${activity.registrationCount} / ${activity.capacity} 人`
    : `${activity.registrationCount} 人`;

  headSlot.append(
    el('p', { style: 'margin:0 0 10px' }, [
      el('a', { class: 'btn btn-ghost btn-sm', href: '/admin', text: '← 回活動管理' }),
    ]),
    el('div', { class: 'page-head' }, [
      el('h1', { text: activity.title }),
      el('p', {}, [
        `${formatDate(activity.eventDate)}${activity.eventTime ? `　${activity.eventTime}` : ''}`,
        activity.location ? `　｜　${activity.location}` : '',
        `　｜　報名 ${seats}`,
        activity.isPast ? '　｜　已結束（過往活動）' : '',
      ].join('')),
    ]),
  );
}

let downloadLink;

async function load() {
  hideNotice(notice);
  const data = await api(`/api/admin/activities/${activityId}/registrations`);
  activity = data.activity;
  roster = data.roster;
  document.title = `${activity.title}｜培力園後台`;
  // 讓下載的檔案直接用活動名稱命名，工作人員一次匯出多個活動才分得出來
  if (downloadLink) {
    downloadLink.download =
      `${activity.title.replace(/[\\/:*?"<>|]+/g, '_')}_報名名冊_${activity.eventDate}.csv`;
  }
  renderHead();
  renderTable();
}

(async () => {
  await requireLogin();
  const root = $('#root');
  root.innerHTML = '';

  const search = el('input', {
    type: 'search', class: 'search', placeholder: '搜尋姓名、身分證、學校、電話、監護人…',
    'aria-label': '搜尋報名者',
  });
  search.addEventListener('input', () => { query = search.value.trim(); renderTable(); });

  downloadLink = el('a', {
    class: 'btn',
    href: `/api/admin/activities/${encodeURIComponent(activityId)}/export.csv`,
    text: '⬇ 下載這個活動的報名資料（CSV）',
  });

  const toolbar = el('div', { class: 'toolbar' }, [
    search,
    downloadLink,
    el('button', { class: 'btn btn-ghost', text: '列印名單', onClick: () => window.print() }),
  ]);

  root.append(
    adminHeader('/admin'),
    el('main', { class: 'wrap-wide' }, [headSlot, notice, toolbar, tableSlot]),
  );

  try {
    await load();
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
})();
