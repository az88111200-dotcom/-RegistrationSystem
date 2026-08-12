import {
  api, $, el, formatDate, daysUntil, toRoc, showNotice, showErrors, hideNotice,
  renderFields, collectFields,
} from './common.js';

const slug = decodeURIComponent(location.pathname.replace(/^\/activity\//, '').replace(/\/$/, ''));
const app = $('#app');
const notice = $('#notice');

let activity = null;
let schema = null;
/** 老朋友查詢成功後放在這裡，送出時只需要帶 studentId。 */
let knownStudent = null;

// ---------------------------------------------------------------- 活動資訊

function activityHeader() {
  const left = daysUntil(activity.eventDate, schema.today);
  const info = [
    ['活動日期', formatDate(activity.eventDate) + (activity.eventTime ? `　${activity.eventTime}` : '')],
    ['活動地點', activity.location],
    ['集合地點', activity.gatheringPlace],
    ['報名截止', activity.registrationDeadline ? formatDate(activity.registrationDeadline) : ''],
    ['名額', seatsLine(activity)],
  ].filter(([, v]) => v);

  let status;
  if (activity.isPast) status = ['badge-past', '活動已結束'];
  else if (activity.isFull && activity.isOpen && activity.acceptingWaitlist) {
    status = ['badge-wait', '已額滿・開放候補'];
  } else if (activity.isFull) status = ['badge-full', '已額滿'];
  else if (!activity.isOpen) status = ['badge-closed', '已截止報名'];
  else if (left !== null && left <= 7) status = ['badge-soon', left === 0 ? '就是今天！' : `剩 ${left} 天報名`];
  else status = ['badge-open', '開放報名中'];

  return el('div', {}, [
    el('p', { style: 'margin:0 0 10px' }, [
      el('a', { href: '/', class: 'btn btn-ghost btn-sm', text: '← 回活動列表' }),
    ]),
    el('div', { class: 'page-head' }, [
      el('div', { class: 'row', style: 'margin-bottom:8px' }, [
        el('span', { class: `badge ${status[0]}`, text: status[1] }),
      ]),
      el('h1', { text: activity.title }),
      activity.summary ? el('p', { text: activity.summary }) : null,
    ]),
    waitlistNotice(activity),
    el('div', { class: 'card' }, [
      el('dl', { class: 'kv' }, info.flatMap(([k, v]) => [
        el('dt', { text: k }), el('dd', { text: v }),
      ])),
      activity.description
        ? el('div', { style: 'margin-top:14px;padding-top:14px;border-top:1px solid var(--line)' }, [
          el('div', { style: 'white-space:pre-wrap', text: activity.description }),
        ])
        : null,
      activity.contact
        ? el('p', { class: 'help', style: 'margin-top:12px', text: activity.contact })
        : null,
    ]),
  ]);
}

/**
 * 名額那一行。
 *
 * 不寫「目前幾個人報名」—— 少年只需要知道還有沒有位子，
 * 報名人數是後台的事。剩餘名額還是講，因為那會影響他要不要現在報。
 */
function seatsLine(a) {
  if (!a.capacity) return '不限名額';
  if (a.isFull) return `${a.capacity} 人，已額滿`;
  return `${a.capacity} 人，還有 ${a.remainingSlots} 個名額`;
}

/**
 * 額滿時最上面那段說明。
 *
 * 少年最想知道的是「那我現在按下去會怎樣」，所以直接寫明現在報名是排候補、
 * 前面排了幾個人、有人取消時會怎麼通知。候補也滿了就老實說滿了。
 */
function waitlistNotice(a) {
  if (!a.isFull || a.isPast || !a.isOpen) return null;

  if (a.acceptingWaitlist) {
    const queue = a.waitlistCount > 0
      ? `目前候補名單有 ${a.waitlistCount} 人，你會排在第 ${a.waitlistCount + 1} 位。`
      : '目前還沒有人候補，你會是候補第 1 位。';
    const room = a.waitlistRemaining !== null && a.waitlistRemaining !== undefined
      ? `（候補還可以收 ${a.waitlistRemaining} 人）`
      : '';
    return el('div', { class: 'notice notice-info' }, [
      el('strong', { text: '這個活動的名額已經滿了，但還可以排候補。' }),
      el('div', { style: 'margin-top:6px' },
        `${queue}${room}有人取消時，我們會照候補順序通知你，`
        + '所以還是可以先報名，記得加 LINE 保持聯絡。'),
    ]);
  }
  return el('div', { class: 'notice notice-warn' }, [
    el('strong', { text: '這個活動已經額滿了。' }),
    el('div', { style: 'margin-top:6px' },
      a.waitlistOpen
        ? `候補名單也已經額滿（${a.waitlistCount} 人），沒辦法再收了。下次記得早點來喔！`
        : '這個活動沒有開放候補。下次記得早點來喔！'),
  ]);
}

// ---------------------------------------------------------------- 報名區

/**
 * 「報名 ≠ 錄取」的紅字提醒。
 *
 * 少年最常誤會的就是「我送出了就等於有位子」，所以報名表上方跟
 * 完成畫面各放一次 —— 填之前看到一次，送出之後再看到一次。
 * LINE ID 直接寫在旁邊，看到的當下就能加。
 */
function admissionWarning() {
  return el('div', { class: 'notice notice-alert' }, [
    el('div', { class: 'alert-main', text: '報名成功不代表錄取成功' }),
    el('div', { class: 'alert-sub' }, [
      el('span', { text: '請務必加 LINE 確認是否錄取　·　少年培力園 LINE ID：' }),
      el('strong', { text: 'pilot.cafe' }),
    ]),
  ]);
}

/**
 * 送出前的兩段說明：個資保護聲明與課程備註。
 *
 * 個資聲明用紅字 —— 這是蒐集個資的告知，要讓人真的看到，
 * 不能跟一般說明文字混在一起。內容由後端的欄位定義提供，
 * 要改字改 src/fields.js 就好。
 */
function formNotes() {
  const notes = [];
  if (schema.privacyNotice) {
    notes.push(el('div', { class: 'notice notice-alert', style: 'text-align:left' }, [
      el('div', { class: 'alert-main', text: schema.privacyNotice.title }),
      el('div', { class: 'alert-sub', text: schema.privacyNotice.body }),
    ]));
  }
  if (schema.courseNotes) {
    notes.push(el('div', { class: 'course-notes' }, [
      el('div', { class: 'course-notes-title', text: schema.courseNotes.title }),
      el('ol', {}, schema.courseNotes.items.map((t) => el('li', { text: t }))),
    ]));
  }
  return notes;
}

/** 額滿時按鈕要講明是排候補，不要讓人以為按下去就有位子。 */
function submitLabel(normal = '送出報名') {
  return activity.isFull && activity.acceptingWaitlist ? '送出候補報名' : normal;
}

/** 該活動自己的題目（每次報名都要填）。 */
function registrationFieldset(values = {}) {
  return el('fieldset', {}, [
    el('legend', { text: '關於這次活動' }),
    renderFields(schema.registrationFields, values),
  ]);
}

/** 送出報名，成功就換成完成畫面。 */
async function submit(payload, button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = '送出中…';
  try {
    hideNotice(notice);
    const result = await api(
      `/api/activities/${encodeURIComponent(activity.slug)}/register`,
      { method: 'POST', body: payload },
    );
    renderDone(result);
  } catch (err) {
    showErrors(notice, err.message);
    button.disabled = false;
    button.textContent = original;
  }
}

function renderDone(result) {
  const waitlisted = Boolean(result.waitlisted);
  app.innerHTML = '';
  hideNotice(notice);
  app.append(el('div', { class: 'card', style: 'text-align:center;padding:44px 20px' }, [
    el('div', { style: 'font-size:3rem;line-height:1', text: waitlisted ? '📝' : '🎉' }),
    el('h1', { style: 'margin:12px 0 6px;font-size:1.35rem',
      text: waitlisted ? `已列入候補（第 ${result.waitlistPosition} 位）` : '報名成功！' }),
    el('p', { style: 'color:var(--ink-soft);margin:0 0 6px', text: result.message }),
    el('p', { class: 'help', text: `活動：${activity.title}　${formatDate(activity.eventDate)}` }),
    el('div', { style: 'text-align:left;margin-top:20px' }, admissionWarning()),
    el('div', { class: 'row', style: 'justify-content:center;margin-top:4px' }, [
      el('a', { class: 'btn', href: '/', text: '回活動列表' }),
    ]),
  ]));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** 第一次報名：完整報名表。 */
function fullForm(prefill = {}) {
  const form = el('form', { novalidate: true });
  const student = schema.studentFields.filter((f) => f.group === 'student');
  const guardian = schema.studentFields.filter((f) => f.group === 'guardian');

  form.append(
    el('fieldset', {}, [el('legend', { text: '少年基本資料' }), renderFields(student, prefill)]),
    el('fieldset', {}, [
      el('legend', { text: '監護人資料（保險用）' }),
      el('p', { class: 'help', style: 'margin:-6px 0 12px' },
        '這些資料是幫你保活動保險用的，請務必填寫正確。'),
      renderFields(guardian, prefill),
    ]),
    registrationFieldset(prefill),
  );

  const button = el('button', { class: 'btn btn-sun btn-block', type: 'submit', text: submitLabel() });
  form.append(...formNotes());
  form.append(el('p', { class: 'help', text: '送出後這些資料會存起來，下次報名其他活動就不用再填一次了。' }));
  form.append(button);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    submit({
      profile: collectFields(schema.studentFields, form),
      answers: collectFields(schema.registrationFields, form),
    }, button);
  });
  return form;
}

/** 老朋友：確認資料 + 只填活動題目。 */
function returningForm(studentData) {
  const form = el('form', { novalidate: true });

  const summaryRows = [
    ['姓名', studentData.name],
    ['出生年月日', `${studentData.birthDate}（民國 ${toRoc(studentData.birthDate)}）`],
    ['就讀學校 / 年級', `${studentData.school}　${studentData.grade}`],
    ['居住區域', studentData.district],
    ['少年手機', studentData.mobile],
    ['監護人', `${studentData.guardianName}（${studentData.guardianRelation}）　${studentData.guardianPhone}`],
  ];

  const editWrap = el('div', { hidden: true });
  let editing = false;

  const editToggle = el('button', {
    type: 'button', class: 'btn btn-ghost btn-sm',
    text: '資料有變動，我要修改',
    onClick: () => {
      editing = !editing;
      if (editing && !editWrap.childElementCount) {
        const student = schema.studentFields.filter((f) => f.group === 'student');
        const guardian = schema.studentFields.filter((f) => f.group === 'guardian');
        editWrap.append(
          el('fieldset', {}, [el('legend', { text: '少年基本資料' }), renderFields(student, studentData)]),
          el('fieldset', {}, [el('legend', { text: '監護人資料（保險用）' }), renderFields(guardian, studentData)]),
        );
      }
      editWrap.hidden = !editing;
      editToggle.textContent = editing ? '取消修改，沿用原本的資料' : '資料有變動，我要修改';
      summaryCard.hidden = editing;
    },
  });

  const summaryCard = el('div', { class: 'card card-sky' }, [
    el('div', { style: 'font-weight:800;margin-bottom:8px' }, `👋 ${studentData.name}，歡迎回來！`),
    el('dl', { class: 'kv' }, summaryRows.flatMap(([k, v]) => [
      el('dt', { text: k }), el('dd', { text: v }),
    ])),
    el('p', { class: 'help', style: 'margin:12px 0 0' },
      `你已經參加過培力園 ${studentData.registrationCount} 次活動，資料我們都幫你留著了。`),
  ]);

  form.append(summaryCard, editWrap, el('p', { style: 'margin:12px 0' }, editToggle));
  form.append(registrationFieldset());

  const button = el('button', { class: 'btn btn-sun btn-block', type: 'submit', text: submitLabel('確認報名') });
  form.append(...formNotes());
  form.append(button);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const payload = {
      studentId: studentData.id,
      answers: collectFields(schema.registrationFields, form),
    };
    // 有改資料才送 profile，順便更新主檔
    if (editing) payload.profile = collectFields(schema.studentFields, form);
    submit(payload, button);
  });
  return form;
}

/** 報名區：先問是不是老朋友。 */
function registrationSection() {
  // 選好報名方式之後，報名表會塞進這裡。上面緊接著活動資訊卡片，
  // 所以要留一段距離 —— 空的時候不留，免得沒東西還撐出一塊空白。
  const slot = el('div', { class: 'form-slot' });
  const chooser = el('div');

  /**
   * 選好報名方式之後，把上面的選擇區收起來只留下報名表，
   * 避免畫面上同時出現兩張表單讓人搞混。
   */
  function showForm(heading, form) {
    chooser.hidden = true;
    slot.innerHTML = '';
    slot.append(
      admissionWarning(),
      el('div', { class: 'row', style: 'margin-bottom:6px' }, [
        el('button', {
          type: 'button', class: 'btn btn-ghost btn-sm', text: '← 重新選擇報名方式',
          onClick: () => {
            chooser.hidden = false;
            slot.innerHTML = '';
            hideNotice(notice);
            chooser.scrollIntoView({ behavior: 'smooth', block: 'start' });
          },
        }),
      ]),
      el('h2', { class: 'section-title', text: heading }),
      form,
    );
    slot.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const lookupForm = el('form', { class: 'card', novalidate: true }, [
    el('div', { style: 'font-weight:800;margin-bottom:4px', text: '報名過培力園活動的老朋友' }),
    el('p', { class: 'help', text: '輸入這三項就好，我們會自動帶出你上次填過的資料。' }),
    el('div', { class: 'grid-2' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'lk_name' }, [el('span', { text: '姓名' }), el('span', { class: 'req', text: '*' })]),
        el('input', { id: 'lk_name', name: 'name', type: 'text', autocomplete: 'name' }),
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'lk_id' }, [el('span', { text: '身分證字號' }), el('span', { class: 'req', text: '*' })]),
        el('input', { id: 'lk_id', name: 'idNumber', type: 'text', placeholder: 'A123456789' }),
      ]),
      el('div', { class: 'field span-2' }, [
        el('label', { for: 'lk_birth' }, [el('span', { text: '出生年月日' }), el('span', { class: 'req', text: '*' })]),
        el('input', { id: 'lk_birth', name: 'birthDate', type: 'date' }),
      ]),
    ]),
    el('button', { class: 'btn btn-block', type: 'submit', text: '帶出我的資料，快速報名' }),
  ]);

  const firstTime = el('div', { class: 'card', style: 'margin-top:14px' }, [
    el('div', { style: 'font-weight:800;margin-bottom:4px', text: '第一次報名培力園活動' }),
    el('p', { class: 'help', text: '第一次要填完整資料（含保險需要的監護人資訊），之後就不用再填了。' }),
    el('button', {
      class: 'btn btn-ghost btn-block', type: 'button', text: '填寫完整報名表',
      onClick: () => showForm('完整報名表', fullForm()),
    }),
  ]);

  lookupForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice(notice);
    const data = Object.fromEntries(new FormData(lookupForm));
    if (!data.name?.trim() || !data.idNumber?.trim() || !data.birthDate) {
      showNotice(notice, 'error', '請輸入姓名、身分證字號與出生年月日。');
      return;
    }
    const button = lookupForm.querySelector('button');
    button.disabled = true;
    button.textContent = '查詢中…';
    try {
      const result = await api('/api/lookup', {
        method: 'POST',
        body: { ...data, activitySlug: activity.slug },
      });
      if (!result.found) {
        // 查不到就直接把剛剛輸入的三項帶進完整報名表，不用重打
        showNotice(notice, 'warn', result.message);
        showForm('完整報名表', fullForm({
          name: data.name.trim(),
          idNumber: data.idNumber.trim(),
          birthDate: data.birthDate,
        }));
        return;
      }
      if (result.alreadyRegistered) {
        showNotice(notice, 'info', `${result.student.name} 已經報名過這個活動了，不用重複報名喔！`);
        slot.innerHTML = '';
        return;
      }
      knownStudent = result.student;
      showForm('確認報名', returningForm(knownStudent));
    } catch (err) {
      showNotice(notice, 'error', err.message);
    } finally {
      button.disabled = false;
      button.textContent = '帶出我的資料，快速報名';
    }
  });

  chooser.append(
    el('h2', { class: 'section-title', text: '我要報名' }),
    admissionWarning(),
    lookupForm,
    firstTime,
  );
  return el('div', {}, [chooser, slot]);
}

function closedNotice() {
  let text = '這個活動目前沒有開放報名。';
  if (activity.isPast) text = '這個活動已經結束了，看看還有沒有其他活動吧！';
  else if (activity.isFull) {
    text = activity.waitlistOpen
      ? `很抱歉，名額與候補都已經額滿了（候補 ${activity.waitlistCount} 人）。`
      : '很抱歉，這個活動已經額滿了。';
  }
  else if (activity.registrationDeadline) text = `報名已於 ${formatDate(activity.registrationDeadline)} 截止。`;
  return el('div', { class: 'card', style: 'margin-top:18px;text-align:center' }, [
    el('p', { style: 'margin:0 0 14px;font-weight:700', text: text }),
    el('a', { class: 'btn btn-ghost', href: '/', text: '看看其他活動' }),
  ]);
}

// ---------------------------------------------------------------- 啟動

(async () => {
  try {
    const [activityRes, schemaRes] = await Promise.all([
      api(`/api/activities/${encodeURIComponent(slug)}`),
      api('/api/form-schema'),
    ]);
    activity = activityRes.activity;
    schema = schemaRes;
    document.title = `${activity.title}｜少年培力園`;

    app.innerHTML = '';
    app.append(activityHeader());
    // 額滿但還收候補時，報名表照樣要開 —— 送出後會排進候補名單。
    // 上面的說明已經講清楚現在報名是排候補了。
    const canSignUp = activity.isOpen && (!activity.isFull || activity.acceptingWaitlist);
    app.append(canSignUp ? registrationSection() : closedNotice());
  } catch (err) {
    app.innerHTML = '';
    showNotice(notice, 'error', err.message);
  }
})();
