// 後台：已報名學生的資料總集。支援搜尋、查看報名紀錄、編輯、刪除、下載。

import {
  api, $, el, formatDate, toRoc, showNotice, hideNotice, displayValue,
  renderFields, collectFields,
} from './common.js';
import { requireLogin, adminHeader, confirmDelete } from './admin-common.js';

let students = [];
let schema = null;
let query = '';

const notice = el('div', { class: 'notice', hidden: true });
const tableSlot = el('div');
const countSlot = el('p', { class: 'help', style: 'margin:0 0 10px' });
let downloadLink;

const COLUMNS = [
  { key: 'seq', label: '#', cls: 'num' },
  { key: 'name', label: '姓名' },
  { key: 'gender', label: '性別' },
  { key: 'age', label: '年齡' },
  { key: 'idNumber', label: '身份證字號' },
  { key: 'birthDate', label: '出生年月日' },
  { key: 'school', label: '就讀學校' },
  { key: 'grade', label: '年級' },
  { key: 'district', label: '居住區域' },
  { key: 'mobile', label: '少年手機' },
  { key: 'lineId', label: 'LINE ID' },
  { key: 'guardianName', label: '監護人' },
  { key: 'guardianPhone', label: '監護人電話' },
  { key: 'registrationCount', label: '報名次數', cls: 'num' },
  { key: 'lastRegisteredAt', label: '最近報名' },
];

/** 展開一位學生：基本資料 + 報名過哪些活動。 */
async function openDetail(student) {
  const dialog = el('dialog');
  const body = el('div', { class: 'dlg-body' }, el('p', { class: 'loading', text: '載入中…' }));
  const close = () => { dialog.close(); dialog.remove(); };

  dialog.append(
    el('div', { class: 'dlg-head', text: `${student.name} 的資料` }),
    body,
    el('div', { class: 'dlg-foot' }, [
      el('button', { class: 'btn btn-ghost', text: '關閉', onClick: close }),
      el('button', { class: 'btn', text: '編輯資料', onClick: () => { close(); openEditor(student); } }),
    ]),
  );
  dialog.addEventListener('cancel', close);
  document.body.append(dialog);
  dialog.showModal();

  try {
    const { student: full, history } = await api(`/api/admin/students/${student.id}`);
    const rows = [
      ['少年姓名', full.name],
      ['性別', full.gender],
      ['目前年齡', full.age],
      ['身份證字號', full.idNumber],
      ['身分別', full.identityType],
      ['特殊家庭狀況', displayValue(full.familyStatus)],
      ['出生年月日', `${full.birthDate}（民國 ${toRoc(full.birthDate)}）`],
      ['就讀學校 / 年級', `${full.school}　${full.grade}`],
      ['學籍/居住區域', full.district],
      ['居住地址', full.address],
      ['住家電話', full.homePhone],
      ['少年手機', full.mobile],
      ['LINE ID', full.lineId],
      ['Email', full.email],
      ['監護人姓名', full.guardianName],
      ['監護人身分證號', full.guardianIdNumber],
      ['監護人出生年月日', `${full.guardianBirthDate}（民國 ${toRoc(full.guardianBirthDate)}）`],
      ['監護人國籍', full.guardianNationality],
      ['與學生關係', full.guardianRelation],
      ['監護人電話', full.guardianPhone],
      ['首次建檔', full.createdAt],
    ];

    body.innerHTML = '';
    body.append(
      el('dl', { class: 'kv' }, rows.flatMap(([k, v]) => [
        el('dt', { text: k }), el('dd', { text: v === '' || v === undefined ? '—' : String(v) }),
      ])),
      el('h3', { style: 'margin:20px 0 8px;font-size:1rem' },
        `報名紀錄（${history.length} 次）`),
      history.length
        ? el('ul', { style: 'margin:0;padding-left:20px' }, history.map((h) => el('li', {}, [
          el('a', { href: `/admin/activity/${h.activityId}`, text: h.activityTitle }),
          el('span', { class: 'help' }, `　${formatDate(h.eventDate)}${h.isPast ? '（已結束）' : ''}`),
        ])))
        : el('p', { class: 'help', text: '目前沒有報名紀錄。' }),
    );
  } catch (err) {
    body.innerHTML = '';
    body.append(el('div', { class: 'notice notice-error', text: err.message }));
  }
}

/** 編輯學生主檔，改完之後之後的活動都會用新資料。 */
function openEditor(student) {
  const dialog = el('dialog');
  const form = el('form', { novalidate: true });
  const err = el('div', { class: 'notice notice-error', hidden: true });

  form.append(
    err,
    el('fieldset', {}, [
      el('legend', { text: '少年基本資料' }),
      renderFields(schema.studentFields.filter((f) => f.group === 'student'), student),
    ]),
    el('fieldset', {}, [
      el('legend', { text: '監護人資料' }),
      renderFields(schema.studentFields.filter((f) => f.group === 'guardian'), student),
    ]),
  );

  const save = el('button', { class: 'btn', text: '儲存' });
  const close = () => { dialog.close(); dialog.remove(); };

  save.addEventListener('click', async (event) => {
    event.preventDefault();
    save.disabled = true;
    try {
      const body = collectFields(schema.studentFields, form);
      await api(`/api/admin/students/${student.id}`, { method: 'PATCH', body });
      close();
      showNotice(notice, 'ok', `已更新 ${student.name} 的資料。`);
      await load();
    } catch (e) {
      err.hidden = false;
      err.innerHTML = '';
      const lines = String(e.message).split('\n').filter(Boolean);
      err.append(el('ul', { style: 'margin:0;padding-left:20px' }, lines.map((l) => el('li', { text: l }))));
      err.scrollIntoView({ block: 'center' });
      save.disabled = false;
    }
  });

  dialog.append(
    el('div', { class: 'dlg-head', text: `編輯 ${student.name} 的資料` }),
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

async function removeStudent(student) {
  const ok = await confirmDelete({
    title: '刪除學生資料',
    message: `確定要刪除「${student.name}」嗎？\n他的 ${student.registrationCount} 筆報名紀錄也會一起刪除，無法復原。`,
    confirmWord: student.name,
    danger: '永久刪除',
  });
  if (!ok) return;
  try {
    const result = await api(`/api/admin/students/${student.id}`, { method: 'DELETE' });
    showNotice(notice, 'ok',
      `已刪除 ${result.deleted}，同時移除 ${result.removedRegistrations} 筆報名紀錄。`);
    await load();
  } catch (e) {
    showNotice(notice, 'error', e.message);
  }
}

function renderTable() {
  tableSlot.innerHTML = '';
  countSlot.textContent = query
    ? `搜尋「${query}」，找到 ${students.length} 位學生`
    : `目前共 ${students.length} 位學生建檔`;

  if (!students.length) {
    tableSlot.append(el('div', { class: 'empty' }, [
      el('strong', { text: query ? '沒有符合的學生' : '還沒有學生資料' }),
      query ? '換個關鍵字試試看。' : '有人完成第一次報名之後，資料就會出現在這裡。',
    ]));
    return;
  }

  tableSlot.append(el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        ...COLUMNS.map((c) => el('th', { class: c.cls || '', text: c.label })),
        el('th', { text: '操作' }),
      ])),
      el('tbody', {}, students.map((student, index) => el('tr', {}, [
        ...COLUMNS.map((c) => {
          if (c.key === 'seq') return el('td', { class: 'num', text: String(index + 1) });
          if (c.key === 'name') {
            return el('td', {}, el('a', {
              href: '#', style: 'font-weight:700', text: student.name,
              onClick: (e) => { e.preventDefault(); openDetail(student); },
            }));
          }
          const value = displayValue(student[c.key]);
          return el('td', { class: c.cls || '', text: value === '' ? '—' : String(value) });
        }),
        el('td', {}, el('div', { class: 'row', style: 'flex-wrap:nowrap' }, [
          el('button', { class: 'btn btn-ghost btn-sm', text: '詳細', onClick: () => openDetail(student) }),
          el('button', { class: 'btn btn-ghost btn-sm', text: '編輯', onClick: () => openEditor(student) }),
          el('button', { class: 'btn btn-danger btn-sm', text: '刪除', onClick: () => removeStudent(student) }),
        ])),
      ]))),
    ]),
  ]));
}

async function load() {
  hideNotice(notice);
  const data = await api(`/api/admin/students?q=${encodeURIComponent(query)}`);
  students = data.students;
  if (downloadLink) {
    downloadLink.href = `/api/admin/students/export.csv?q=${encodeURIComponent(query)}`;
    downloadLink.textContent = query
      ? `⬇ 下載搜尋結果（${students.length} 人）`
      : '⬇ 下載全部學生資料（CSV）';
    downloadLink.download = query
      ? `培力園_學生資料_${query.replace(/[\\/:*?"<>|]+/g, '_')}.csv`
      : '培力園_學生資料總表.csv';
  }
  renderTable();
}

(async () => {
  await requireLogin();
  schema = await api('/api/form-schema');

  const root = $('#root');
  root.innerHTML = '';

  const search = el('input', {
    type: 'search', class: 'search',
    placeholder: '搜尋姓名、身分證字號、學校、區域、電話、LINE ID、監護人…',
    'aria-label': '搜尋學生',
  });

  // 邊打邊搜尋，稍微延遲避免每個字都打一次 API
  let timer;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      query = search.value.trim();
      load().catch((err) => showNotice(notice, 'error', err.message));
    }, 200);
  });

  downloadLink = el('a', { class: 'btn', href: '#', text: '⬇ 下載全部學生資料（CSV）' });

  root.append(
    adminHeader('/admin/students'),
    el('main', { class: 'wrap-wide' }, [
      el('div', { class: 'page-head' }, [
        el('h1', { text: '學生資料總集' }),
        el('p', { text: '所有報名過培力園活動的少年都在這裡。點姓名可以看完整資料與報名紀錄。' }),
      ]),
      notice,
      el('div', { class: 'toolbar' }, [search, downloadLink]),
      countSlot,
      tableSlot,
    ]),
  );

  try {
    await load();
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
})();
