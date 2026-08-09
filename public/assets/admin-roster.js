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

  // 報名名單與簽到分成兩個分頁，畫面才不會一次塞太多東西
  const attendanceSlot = el('div', { hidden: true });
  const rosterSlot = el('div', {}, [toolbar, tableSlot]);
  const tabs = el('div', { class: 'tabs' });

  const showTab = async (which) => {
    const isRoster = which === 'roster';
    rosterSlot.hidden = !isRoster;
    attendanceSlot.hidden = isRoster;
    for (const b of tabs.children) {
      b.setAttribute('aria-selected', String(b.dataset.tab === which));
    }
    if (!isRoster) {
      try {
        await renderAttendance(attendanceSlot, activityId, activity ? activity.title : '');
      } catch (err) {
        showNotice(notice, 'error', err.message);
      }
    }
  };

  for (const [key, label] of [['roster', '報名名單'], ['attendance', '簽到與出席']]) {
    const btn = el('button', { class: 'tab', text: label, onClick: () => showTab(key) });
    btn.dataset.tab = key;
    tabs.append(btn);
  }

  root.append(
    adminHeader('/admin'),
    el('main', { class: 'wrap-wide' }, [headSlot, notice, tabs, rosterSlot, attendanceSlot]),
  );

  try {
    await load();
    await showTab('roster');
  } catch (err) {
    showNotice(notice, 'error', err.message);
  }
})();

// ---------------------------------------------------------------- 簽到

/** 簽到用的網址。帶上場次代號，掃碼進去就已經選好課程。 */
function checkinUrl(sessionId) {
  return `${location.origin}/checkin${sessionId ? `?session=${encodeURIComponent(sessionId)}` : ''}`;
}

/** 顯示某一場的 QR，讓工作人員印出來貼在現場。 */
async function openQr(session, activityTitle) {
  const { qrSvg } = await import('./qr.js');
  const url = checkinUrl(session.id);
  const dialog = el('dialog');
  const close = () => { dialog.close(); dialog.remove(); };

  const box = el('div', { style: 'text-align:center' });
  box.innerHTML = qrSvg(url, { scale: 6 });
  box.firstChild.style.maxWidth = '100%';
  box.firstChild.style.height = 'auto';

  dialog.append(
    el('div', { class: 'dlg-head', text: '簽到 QR Code' }),
    el('div', { class: 'dlg-body' }, [
      el('p', { style: 'margin:0 0 4px;font-weight:700', text: activityTitle }),
      el('p', { class: 'help', style: 'margin:0 0 14px' },
        `${formatDate(session.date)}${session.title ? `　${session.title}` : ''}`),
      box,
      el('p', { class: 'help', style: 'margin-top:12px;word-break:break-all', text: url }),
      el('p', { class: 'help' }, '把這張印出來貼在報到處，少年掃碼就會自動選好這一堂課。'),
    ]),
    el('div', { class: 'dlg-foot' }, [
      el('button', { class: 'btn btn-ghost', text: '關閉', onClick: close }),
      el('button', {
        class: 'btn', text: '列印',
        onClick: () => {
          const w = window.open('', '_blank');
          if (!w) return;
          w.document.write(
            `<title>${activityTitle} 簽到 QR</title>`
            + '<body style="font-family:sans-serif;text-align:center;padding:40px">'
            + `<h2>${activityTitle}</h2><p>${formatDate(session.date)}</p>`
            + `${qrSvg(url, { scale: 8 })}<p style="color:#666;font-size:13px">${url}</p></body>`,
          );
          w.document.close();
          w.print();
        },
      }),
    ]),
  );
  dialog.addEventListener('cancel', close);
  document.body.append(dialog);
  dialog.showModal();
}

/** 某一場的簽到名單，可以代簽與移除。 */
async function openSession(session) {
  const dialog = el('dialog');
  const body = el('div', { class: 'dlg-body' }, el('p', { class: 'loading', text: '載入中…' }));
  const close = () => { dialog.close(); dialog.remove(); load(); };

  const refresh = async () => {
    const data = await api(`/api/admin/sessions/${session.id}`);
    body.innerHTML = '';

    const name = el('input', { type: 'text', placeholder: '姓名' });
    const idNo = el('input', { type: 'text', placeholder: '身分證字號' });
    const add = el('button', { class: 'btn btn-sm', text: '代為簽到' });
    const err = el('p', { class: 'help' });

    add.addEventListener('click', async () => {
      add.disabled = true;
      try {
        await api(`/api/admin/sessions/${session.id}/checkin`, {
          method: 'POST', body: { name: name.value, idNumber: idNo.value },
        });
        name.value = ''; idNo.value = '';
        await refresh();
      } catch (e) {
        err.textContent = e.message;
        err.style.color = 'var(--danger)';
      } finally {
        add.disabled = false;
      }
    });

    body.append(
      el('p', { class: 'help', style: 'margin:0 0 12px' },
        `已簽到 ${data.attendees.length} 人`),
      data.attendees.length
        ? el('div', { class: 'table-scroll' }, [
          el('table', {}, [
            el('thead', {}, el('tr', {}, [
              el('th', { text: '姓名' }), el('th', { text: '簽到時間' }),
              el('th', { text: '方式' }), el('th', { text: '' }),
            ])),
            el('tbody', {}, data.attendees.map((a) => el('tr', {}, [
              el('td', {}, [
                el('span', { style: 'font-weight:700', text: a.name }),
                a.wasRegistered ? null : el('span', { class: 'badge badge-soon', style: 'margin-left:6px', text: '未報名' }),
              ]),
              el('td', { text: a.checkedInAt.slice(5, 16) }),
              el('td', { text: a.method === 'manual' ? '工作人員代簽' : '掃碼' }),
              el('td', {}, el('button', {
                class: 'btn btn-danger btn-sm', text: '移除',
                onClick: async () => {
                  await api(`/api/admin/attendances/${a.attendanceId}`, { method: 'DELETE' });
                  await refresh();
                },
              })),
            ]))),
          ]),
        ])
        : el('div', { class: 'empty', style: 'padding:24px' }, '還沒有人簽到'),
      el('div', { style: 'margin-top:16px;padding-top:14px;border-top:1px solid var(--line)' }, [
        el('div', { class: 'field-label', text: '沒帶手機？工作人員可以代簽' }),
        el('div', { class: 'row' }, [name, idNo, add]),
        err,
      ]),
    );
  };

  dialog.append(
    el('div', { class: 'dlg-head', text: `${formatDate(session.date)} 簽到名單` }),
    body,
    el('div', { class: 'dlg-foot' }, [
      el('button', { class: 'btn btn-ghost', text: '關閉', onClick: close }),
    ]),
  );
  dialog.addEventListener('cancel', close);
  document.body.append(dialog);
  dialog.showModal();
  await refresh();
}

/** 出席總覽：報名者 × 各場次的勾勾表。 */
function attendanceTable(data) {
  const { sessions, rows } = data;
  if (!rows.length) {
    return el('div', { class: 'empty' }, [
      el('strong', { text: '還沒有人報名或簽到' }),
    ]);
  }
  return el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '姓名' }),
        el('th', { text: '居住區域' }),
        ...sessions.map((s) => el('th', { class: 'num', text: s.date.slice(5).replace('-', '/') })),
        el('th', { class: 'num', text: '出席' }),
      ])),
      el('tbody', {}, rows.map((r) => el('tr', {}, [
        el('td', {}, [
          el('span', { style: 'font-weight:700', text: r.name }),
          r.registered ? null : el('span', { class: 'badge badge-soon', style: 'margin-left:6px', text: '未報名' }),
        ]),
        el('td', { text: r.district || '—' }),
        ...r.attended.map((yes) => el('td', {
          class: 'num',
          style: yes ? 'color:var(--ok);font-weight:800' : 'color:var(--ink-faint)',
          text: yes ? '✓' : '·',
        })),
        el('td', { class: 'num', style: 'font-weight:800', text: `${r.attendedCount}/${sessions.length}` }),
      ]))),
    ]),
  ]);
}

/** 場次清單，每一場都能看名單、開 QR。 */
function sessionList(sessions, activityTitle) {
  return el('div', { class: 'table-scroll' }, [
    el('table', {}, [
      el('thead', {}, el('tr', {}, [
        el('th', { text: '日期' }), el('th', { text: '時間' }), el('th', { text: '堂次名稱' }),
        el('th', { class: 'num', text: '簽到人數' }), el('th', { text: '操作' }),
      ])),
      el('tbody', {}, sessions.map((s) => el('tr', {}, [
        el('td', { text: formatDate(s.date) }),
        el('td', { text: s.startTime ? `${s.startTime}${s.endTime ? `-${s.endTime}` : ''}` : '—' }),
        el('td', { text: s.title || '—' }),
        el('td', { class: 'num', text: String(s.attendanceCount ?? 0) }),
        el('td', {}, el('div', { class: 'row', style: 'flex-wrap:nowrap' }, [
          el('button', { class: 'btn btn-ghost btn-sm', text: '簽到名單', onClick: () => openSession(s) }),
          el('button', { class: 'btn btn-ghost btn-sm', text: 'QR', onClick: () => openQr(s, activityTitle) }),
        ])),
      ]))),
    ]),
  ]);
}

/** 把簽到相關的區塊掛到頁面上。 */
export async function renderAttendance(container, activityId, activityTitle) {
  container.innerHTML = '';
  container.append(el('p', { class: 'loading', text: '載入中…' }));
  const data = await api(`/api/admin/activities/${activityId}/attendance`);
  container.innerHTML = '';

  const total = data.rows.reduce((sum, r) => sum + r.attendedCount, 0);
  container.append(
    el('div', { class: 'stat-grid' }, [
      ['課程堂數', data.sessions.length],
      ['出席人次', total],
      ['報名人數', data.rows.filter((r) => r.registered).length],
    ].map(([l, n]) => el('div', { class: 'stat' }, [
      el('div', { class: 'n', text: String(n) }),
      el('div', { class: 'l', text: l }),
    ]))),
    el('div', { class: 'row', style: 'margin-bottom:14px' }, [
      el('a', {
        class: 'btn', href: `/checkin?session=${data.sessions[0]?.id || ''}`, target: '_blank',
        rel: 'noopener', text: '開啟簽到頁',
      }),
      el('button', {
        class: 'btn btn-ghost', text: '顯示今天的簽到 QR',
        onClick: () => {
          const today = new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
          const s = data.sessions.find((x) => x.date === today) || data.sessions[0];
          if (s) openQr(s, activityTitle);
        },
      }),
    ]),
    el('h2', { class: 'section-title', text: '課程場次' }),
    sessionList(data.sessions, activityTitle),
    el('h2', { class: 'section-title', text: '出席總覽' }),
    attendanceTable(data),
  );
}
