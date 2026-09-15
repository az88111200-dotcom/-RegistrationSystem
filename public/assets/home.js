import { api, $, el, showNotice } from './common.js';
import { fillActivities } from './activity-card.js';

/**
 * 活動總覽把活動分成三區，用上面的分頁切換：
 *   1. 開放報名中 —— 還沒舉行，而且真的可以按下報名
 *   2. 已截止／額滿 —— 還沒舉行，但額滿、過了截止日或被工作人員關閉
 *   3. 過往活動 —— 已經結束的
 *
 * 第 2 區獨立出來，才不會讓少年在「開放報名中」點進去才發現不能報；
 * 第 3 區以前是另外一頁，現在收在這裡 —— 導覽列少一個東西，
 * 想看我們平常在做什麼的人也不用另外找。
 */
const canRegister = (a) => a.isOpen && !a.isFull;

/** 分頁按鈕。數字寫在標籤上，一眼看得出哪一區有東西。 */
function renderTabs(counts, onPick) {
  const bar = $('#tabs');
  bar.innerHTML = '';
  const keys = [
    ['open', '開放報名中'],
    ['closed', '已截止／額滿'],
    ['past', '過往活動'],
  ];
  for (const [key, label] of keys) {
    const btn = el('button', {
      class: 'tab', type: 'button', 'aria-selected': key === 'open' ? 'true' : 'false',
      text: `${label}（${counts[key]}）`,
    });
    btn.dataset.key = key;
    btn.addEventListener('click', () => {
      for (const b of bar.children) b.setAttribute('aria-selected', b === btn ? 'true' : 'false');
      onPick(key);
    });
    bar.append(btn);
  }
}

(async () => {
  try {
    const [{ activities }, schema] = await Promise.all([
      api('/api/activities'),
      api('/api/form-schema'),
    ]);
    const { today } = schema;

    const upcoming = activities.filter((a) => !a.isPast);
    const open = upcoming.filter(canRegister);
    const closed = upcoming.filter((a) => !canRegister(a));
    const past = activities.filter((a) => a.isPast);

    fillActivities(
      $('#upcoming'), open, today,
      '目前沒有開放報名的活動',
      '之後有新活動會出現在這裡，記得回來看看。',
    );
    fillActivities($('#closed'), closed, today, '沒有已截止或額滿的活動', '');
    fillActivities($('#past'), past, today, '還沒有結束的活動', '');

    const sections = {
      open: $('#open-section'),
      closed: $('#closed-section'),
      past: $('#past-section'),
    };
    const show = (key) => {
      for (const [name, section] of Object.entries(sections)) section.hidden = name !== key;
    };
    renderTabs({ open: open.length, closed: closed.length, past: past.length }, show);
    show('open');
  } catch (err) {
    $('#upcoming').innerHTML = '';
    showNotice($('#notice'), 'error', err.message);
  }
})();
