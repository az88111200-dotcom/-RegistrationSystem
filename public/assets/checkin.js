// 前台簽到頁。少年掃 QR 進來，選課程、填姓名就完成簽到。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';

const app = $('#app');
const notice = $('#notice');

// 全園共用一張 QR（掃進來就是這一頁），另外也支援舊的 ?session= 連結：
// 帶了場次就先幫他選好，少年只要填名字。
const params = new URLSearchParams(location.search);
const presetSession = params.get('session') || '';

function timeLabel(session) {
  if (!session.startTime) return '';
  return session.endTime ? `${session.startTime}-${session.endTime}` : session.startTime;
}

function sessionLabel(session) {
  const time = timeLabel(session);
  return [session.activityTitle, session.title, time].filter(Boolean).join('　·　');
}

function renderDone(result) {
  app.innerHTML = '';
  hideNotice(notice);
  app.append(el('div', { class: 'card', style: 'text-align:center;padding:44px 20px' }, [
    el('div', { style: 'font-size:3rem;line-height:1', text: '✅' }),
    el('h1', { style: 'margin:12px 0 6px;font-size:1.35rem', text: '簽到完成！' }),
    el('p', { style: 'font-size:1.1rem;font-weight:700;margin:0 0 4px', text: result.studentName }),
    el('p', { class: 'help', text: `${result.activityTitle}　${formatDate(result.sessionDate)}` }),
    !result.wasRegistered
      ? el('div', { class: 'notice notice-warn', style: 'margin:18px 0 0;text-align:left' },
        '你沒有事先報名這個活動，簽到還是有記錄到。記得跟現場社工說一聲。')
      : null,
    el('div', { class: 'row', style: 'justify-content:center;margin-top:20px' }, [
      el('button', {
        class: 'btn btn-ghost', text: '換下一個人簽到',
        onClick: () => { location.href = location.pathname + location.search; },
      }),
    ]),
  ]));
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function buildForm(sessions, date) {
  const form = el('form', { class: 'card', novalidate: true });

  const select = el('select', { id: 'ck_session', name: 'sessionId', required: true });
  select.append(el('option', { value: '', text: '請選擇你參加的課程…' }));
  for (const s of sessions) {
    const option = el('option', { value: s.id, text: sessionLabel(s) });
    if (s.id === presetSession) option.selected = true;
    select.append(option);
  }

  const name = el('input', { id: 'ck_name', name: 'name', type: 'text', autocomplete: 'name' });

  // 出生年月日平常不出現。只有遇到同名的少年、後端說分不出是誰時才展開。
  const birth = el('input', { id: 'ck_birth', name: 'birthDate', type: 'date', max: '2100-12-31' });
  const birthField = el('div', { class: 'field', hidden: true }, [
    el('label', { for: 'ck_birth' }, [
      el('span', { text: '出生年月日' }),
      el('span', { class: 'help', text: '有同名的人，用生日確認是你' }),
    ]),
    birth,
  ]);

  const button = el('button', { class: 'btn btn-sun btn-block', type: 'submit', text: '完成簽到' });

  form.append(
    el('div', { class: 'field' }, [
      el('label', { for: 'ck_session' }, [
        el('span', { text: '參加的課程' }),
        el('span', { class: 'req', text: '*' }),
        el('span', { class: 'help', text: `${formatDate(date)} 的課程` }),
      ]),
      select,
    ]),
    el('div', { class: 'field' }, [
      el('label', { for: 'ck_name' }, [
        el('span', { text: '你的姓名' }),
        el('span', { class: 'req', text: '*' }),
        el('span', { class: 'help', text: '跟報名時填的一樣' }),
      ]),
      name,
    ]),
    birthField,
    button,
  );

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice(notice);
    if (!select.value) return showNotice(notice, 'error', '請先選擇你參加的課程。');
    if (!name.value.trim()) return showNotice(notice, 'error', '請填寫你的姓名。');
    if (!birthField.hidden && !birth.value) {
      return showNotice(notice, 'error', '請填寫出生年月日，才知道是哪一位。');
    }
    button.disabled = true;
    button.textContent = '簽到中…';
    try {
      const result = await api('/api/checkin', {
        method: 'POST',
        body: { sessionId: select.value, name: name.value, birthDate: birth.value || undefined },
      });
      if (result.needsBirthDate) {
        birthField.hidden = false;
        showNotice(notice, 'warn', result.message);
        birth.focus();
      } else {
        renderDone(result);
      }
    } catch (err) {
      showNotice(notice, 'error', err.message);
    } finally {
      if (!document.body.contains(button)) return;
      button.disabled = false;
      button.textContent = '完成簽到';
    }
    return undefined;
  });

  return form;
}

(async () => {
  try {
    const { date, sessions } = await api('/api/checkin/sessions');
    app.innerHTML = '';

    if (!sessions.length) {
      app.append(el('div', { class: 'empty' }, [
        el('strong', { text: '今天沒有課程' }),
        `${formatDate(date)} 沒有安排活動。如果時間不對，請找現場社工協助。`,
      ]));
      return;
    }

    app.append(
      el('div', { class: 'page-head' }, [
        el('h1', { text: '活動簽到' }),
        el('p', { text: '選一下你參加的課程，填姓名就完成了。' }),
      ]),
      buildForm(sessions, date),
    );
    // 只有一堂課的時候直接選好，少年連下拉都不用點
    if (sessions.length === 1) $('#ck_session').value = sessions[0].id;
    $('#ck_name').focus();
  } catch (err) {
    app.innerHTML = '';
    showNotice(notice, 'error', err.message);
  }
})();
