// 前台：課程前測 / 後測問卷。
//
// 少年現場掃 QR 進來就填，所以只問姓名（跟簽到同一套認人方式），
// 同名的人不只一位時才追問生日。一群人排隊填，欄位愈少愈好。

import { api, $, el, formatDate, showNotice, showErrors, hideNotice } from './common.js';

const app = $('#app');
const notice = $('#notice');

const m = /^\/survey\/([^/]+)\/(pre|post)\/?$/.exec(location.pathname);
const slug = m ? decodeURIComponent(m[1]) : '';
const phase = m ? m[2] : '';

const PHASE_LABEL = { pre: '課前問卷', post: '課後問卷' };

let form = null;
/** 同名追問生日時，要把剛剛填好的答案留著，不然整份要重填。 */
let pendingAnswers = null;

// ---------------------------------------------------------------- 題目

/**
 * 一題。量表用一整排可以按的按鈕，不用下拉選單 ——
 * 手機上單手按得到，也看得到 1 到 5 分別代表什麼。
 */
function questionField(question, index) {
  const wrap = el('div', { class: 'survey-q' }, [
    el('div', { class: 'survey-q-text' }, [
      el('span', { class: 'survey-q-num', text: String(index + 1) }),
      el('span', { text: question.text }),
    ]),
  ]);

  if (question.type === 'scale') {
    const scale = el('div', { class: 'scale-row' });
    for (let i = 1; i <= 5; i += 1) {
      const input = el('input', { type: 'radio', name: question.id, value: String(i) });
      scale.append(el('label', { class: 'scale-item' }, [
        input,
        el('span', { class: 'scale-num', text: String(i) }),
        el('span', { class: 'scale-label', text: form.scaleLabels[i - 1] || '' }),
      ]));
    }
    wrap.append(scale);
    return wrap;
  }

  if (question.type === 'single' || question.type === 'multi') {
    const type = question.type === 'single' ? 'radio' : 'checkbox';
    wrap.append(el('div', { class: 'choices survey-choices' }, question.options.map((opt) => el(
      'label', { class: 'choice' },
      [el('input', { type, name: question.id, value: opt }), el('span', { text: opt })],
    ))));
    if (question.type === 'multi') {
      wrap.append(el('p', { class: 'help', style: 'margin:6px 0 0', text: '可以選很多個' }));
    }
    return wrap;
  }

  wrap.append(el('textarea', {
    name: question.id, rows: 3, 'aria-label': question.text,
    placeholder: '寫下你想說的，多少都可以',
  }));
  return wrap;
}

/** 把畫面上的作答收成 { 題目代號: 答案 }。 */
function collect(formEl) {
  const answers = {};
  for (const q of form.questions) {
    if (q.type === 'multi') {
      answers[q.id] = [...formEl.querySelectorAll(`[name="${q.id}"]:checked`)].map((n) => n.value);
      continue;
    }
    if (q.type === 'scale' || q.type === 'single') {
      const picked = formEl.querySelector(`[name="${q.id}"]:checked`);
      answers[q.id] = picked ? picked.value : '';
      continue;
    }
    answers[q.id] = formEl.querySelector(`[name="${q.id}"]`)?.value || '';
  }
  return answers;
}

// ---------------------------------------------------------------- 畫面

function renderDone(result) {
  app.innerHTML = '';
  hideNotice(notice);
  app.append(el('div', { class: 'card', style: 'text-align:center;padding:44px 20px' }, [
    el('div', { style: 'font-size:3rem;line-height:1', text: '✅' }),
    el('h1', { style: 'margin:12px 0 6px;font-size:1.35rem', text: '填寫完成，謝謝你！' }),
    el('p', { style: 'font-size:1.1rem;font-weight:700;margin:0 0 4px', text: result.studentName }),
    el('p', { class: 'help', text: `${result.activityTitle}　${PHASE_LABEL[result.phase]}` }),
    result.replaced
      ? el('div', { class: 'notice notice-info', style: 'margin:18px 0 0;text-align:left' },
        '你之前已經填過這一份了，這次的答案覆蓋掉舊的。')
      : null,
    el('div', { class: 'row', style: 'justify-content:center;margin-top:20px' }, [
      el('button', {
        class: 'btn btn-ghost', text: '換下一個人填',
        onClick: () => { location.reload(); },
      }),
    ]),
  ]));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/** 同名的少年不只一位，追問生日確認是哪一位。 */
function renderBirthDateAsk(message, name) {
  const birth = el('input', { type: 'date', id: 'sv_birth', max: '2100-12-31' });
  const button = el('button', { class: 'btn btn-sun btn-block', type: 'submit', text: '確認送出' });
  const formEl = el('form', { class: 'card', novalidate: true }, [
    el('p', { style: 'margin:0 0 12px;font-weight:700', text: message }),
    el('div', { class: 'field' }, [
      el('label', { for: 'sv_birth' }, [el('span', { text: '出生年月日' })]),
      birth,
    ]),
    button,
  ]);
  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!birth.value) {
      showNotice(notice, 'error', '請選出生年月日。');
      return;
    }
    await send({ name, birthDate: birth.value, answers: pendingAnswers }, button);
  });
  app.innerHTML = '';
  app.append(el('div', { class: 'page-head' }, [el('h1', { text: '確認一下是哪一位' })]), formEl);
}

async function send(payload, button) {
  button.disabled = true;
  const original = button.textContent;
  button.textContent = '送出中…';
  try {
    hideNotice(notice);
    const result = await api(`/api/survey/${encodeURIComponent(slug)}/${phase}`, {
      method: 'POST', body: payload,
    });
    if (result.needsBirthDate) {
      pendingAnswers = payload.answers;
      renderBirthDateAsk(result.message, payload.name);
      return;
    }
    renderDone(result);
  } catch (err) {
    showErrors(notice, err.message);
    button.disabled = false;
    button.textContent = original;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function renderForm() {
  const nameInput = el('input', {
    id: 'sv_name', name: 'name', type: 'text', autocomplete: 'name',
    placeholder: '你的姓名',
  });
  const button = el('button', { class: 'btn btn-sun btn-block', type: 'submit', text: '送出問卷' });

  const formEl = el('form', { novalidate: true }, [
    el('div', { class: 'card' }, [
      el('div', { class: 'field', style: 'margin-bottom:0' }, [
        el('label', { for: 'sv_name' }, [
          el('span', { text: '姓名' }),
          el('span', { class: 'req', text: '*' }),
          el('span', { class: 'help', text: '填報名時用的名字就好' }),
        ]),
        nameInput,
      ]),
    ]),
    ...form.questions.map(questionField),
    button,
  ]);

  formEl.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = nameInput.value.trim();
    if (!name) {
      showNotice(notice, 'error', '請填你的姓名。');
      nameInput.focus();
      return;
    }
    await send({ name, answers: collect(formEl) }, button);
  });

  app.innerHTML = '';
  app.append(
    el('div', { class: 'page-head' }, [
      el('h1', { text: `${form.activity.title}　${PHASE_LABEL[phase]}` }),
      el('p', {}, phase === 'pre'
        ? '上課前先填這一份，讓我們知道你現在的狀況。沒有標準答案，照你真正的感覺選就好。'
        : '課程結束了，再填一次同樣的問題，就看得出這段時間你的變化。謝謝你的參與！'),
    ]),
    formEl,
  );
}

function renderClosed() {
  const why = !form.hasQuestions
    ? '這份問卷還沒有設定題目，請找現場社工。'
    : '這份問卷目前沒有開放填寫。時間到了社工會再告訴你。';
  app.innerHTML = '';
  app.append(el('div', { class: 'card', style: 'text-align:center;padding:40px 20px' }, [
    el('div', { style: 'font-size:2.4rem;line-height:1', text: '🕒' }),
    el('h1', { style: 'margin:10px 0 6px;font-size:1.2rem', text: `${form.activity.title}　${PHASE_LABEL[phase]}` }),
    el('p', { style: 'margin:0', text: why }),
    el('p', { class: 'help', text: formatDate(form.activity.eventDate) }),
  ]));
}

(async () => {
  if (!slug || !phase) {
    showNotice(notice, 'error', '網址不正確，請重新掃一次 QR Code。');
    app.innerHTML = '';
    return;
  }
  try {
    form = await api(`/api/survey/${encodeURIComponent(slug)}/${phase}`);
    document.title = `${form.activity.title} ${PHASE_LABEL[phase]}｜少年培力園`;
    if (form.open) renderForm();
    else renderClosed();
  } catch (err) {
    app.innerHTML = '';
    showNotice(notice, 'error', err.message);
  }
})();
