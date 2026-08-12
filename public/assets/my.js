// 前台：少年自己查「我報名過哪些活動」。只要姓名 + 身分證字號。

import { api, $, el, formatDate, showNotice, hideNotice } from './common.js';

const app = $('#app');
const notice = $('#notice');

/** 一筆報名紀錄。講清楚是正取還是候補、活動過了沒。 */
function registrationCard(r) {
  const classes = ['activity-card'];
  if (r.isPast) classes.push('is-past');

  let badge;
  if (r.isPast) badge = el('span', { class: 'badge badge-past', text: '已結束' });
  else if (r.waitlisted) {
    badge = el('span', { class: 'badge badge-wait', text: `候補第 ${r.waitlistPosition} 位` });
  } else badge = el('span', { class: 'badge badge-open', text: '報名成功' });

  // 連續性課程寫出起訖，單日活動就寫當天加時間
  const series = r.endDate && r.endDate !== r.eventDate;
  const when = series
    ? `${formatDate(r.eventDate)} - ${r.endDate.slice(5).replace('-', '/')}`
    : formatDate(r.eventDate) + (r.eventTime ? `　${r.eventTime}` : '');

  return el('a', {
    class: classes.join(' '),
    href: `/activity/${encodeURIComponent(r.activitySlug)}`,
  }, [
    el('span', { class: 'ac-body' }, [
      el('span', { class: 'ac-title', text: r.activityTitle }),
      el('span', { class: 'ac-meta' }, [
        el('span', { class: 'ac-when', text: when }),
        r.location ? el('span', { class: 'ac-where', text: `　·　${r.location}` }) : null,
      ]),
    ]),
    el('span', { class: 'ac-side' }, [badge]),
  ]);
}

function renderResult(data, who) {
  const box = el('div');

  if (!data.found) {
    box.append(el('div', { class: 'empty' }, [
      el('strong', { text: '查不到報名紀錄' }),
      '請確認姓名與身分證字號都填對了。如果你還沒報名過培力園的活動，'
      + '就還不會有紀錄；有問題可以用 LINE 問我們（LINE ID：pilot.cafe）。',
    ]));
    return box;
  }

  const list = data.registrations;
  box.append(el('div', { class: 'card card-sky', style: 'margin-bottom:18px' }, [
    el('div', { style: 'font-weight:800' }, `👋 ${data.name}，你報名過 ${list.length} 個活動`),
  ]));

  if (!list.length) {
    box.append(el('div', { class: 'empty' }, [
      el('strong', { text: '目前沒有報名紀錄' }),
      '到首頁看看有什麼活動吧！',
    ]));
    return box;
  }

  const upcoming = list.filter((r) => !r.isPast);
  const past = list.filter((r) => r.isPast);

  if (upcoming.length) {
    box.append(
      el('h2', { class: 'section-title', text: '即將舉行' }),
      el('div', { class: 'activity-list' }, upcoming.map(registrationCard)),
    );
  }
  if (past.length) {
    box.append(
      el('h2', { class: 'section-title', text: '已經結束' }),
      el('div', { class: 'activity-list' }, past.map(registrationCard)),
    );
  }

  // 候補的人最需要知道下一步要做什麼
  if (upcoming.some((r) => r.waitlisted)) {
    box.append(el('div', { class: 'notice notice-info', style: 'margin-top:18px' },
      '標著「候補」的活動表示名額已滿，你排在候補名單上。'
      + '有人取消時我們會照順序通知你，記得加 LINE 保持聯絡。'));
  }

  box.append(el('div', { class: 'notice notice-alert', style: 'margin-top:18px' }, [
    el('div', { class: 'alert-main', text: '報名成功不代表錄取成功' }),
    el('div', { class: 'alert-sub' }, [
      el('span', { text: '請務必加 LINE 確認是否錄取　·　少年培力園 LINE ID：' }),
      el('strong', { text: 'pilot.cafe' }),
    ]),
  ]));

  box.append(el('p', { class: 'row', style: 'margin-top:18px' }, [
    el('button', {
      class: 'btn btn-ghost btn-sm', type: 'button', text: '← 查別人的',
      onClick: () => { app.innerHTML = ''; app.append(searchForm(who)); },
    }),
  ]));
  return box;
}

function searchForm(prefill = {}) {
  const name = el('input', {
    id: 'q_name', name: 'name', type: 'text', autocomplete: 'name', value: prefill.name || '',
  });
  const idNumber = el('input', {
    id: 'q_id', name: 'idNumber', type: 'text', placeholder: 'A123456789',
    autocapitalize: 'characters', value: '',
  });
  const button = el('button', { class: 'btn btn-sun btn-block', type: 'submit', text: '查詢' });

  const form = el('form', { class: 'card', novalidate: true }, [
    el('div', { class: 'grid-2' }, [
      el('div', { class: 'field' }, [
        el('label', { for: 'q_name' }, [
          el('span', { text: '姓名' }), el('span', { class: 'req', text: '*' }),
        ]),
        name,
      ]),
      el('div', { class: 'field' }, [
        el('label', { for: 'q_id' }, [
          el('span', { text: '身分證字號' }), el('span', { class: 'req', text: '*' }),
          el('span', { class: 'help', text: '跟報名時填的一樣' }),
        ]),
        idNumber,
      ]),
    ]),
    button,
  ]);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    hideNotice(notice);
    if (!name.value.trim() || !idNumber.value.trim()) {
      showNotice(notice, 'error', '請輸入姓名與身分證字號。');
      return;
    }
    button.disabled = true;
    button.textContent = '查詢中…';
    try {
      const data = await api('/api/my-registrations', {
        method: 'POST', body: { name: name.value, idNumber: idNumber.value },
      });
      app.innerHTML = '';
      app.append(renderResult(data, { name: name.value }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      showNotice(notice, 'error', err.message);
      button.disabled = false;
      button.textContent = '查詢';
    }
  });

  return form;
}

app.append(searchForm());
$('#q_name').focus();
