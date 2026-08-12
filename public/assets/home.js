import { api, $, showNotice } from './common.js';
import { fillActivities } from './activity-card.js';

/**
 * 首頁把活動分成兩區：
 *   1. 開放報名中 —— 還沒舉行，而且真的可以按下報名
 *   2. 已截止／額滿 —— 還沒舉行，但額滿、過了截止日或被工作人員關閉
 * 第 2 區獨立出來，才不會讓少年在「開放報名中」點進去才發現不能報。
 * 已經結束的活動不放首頁，導覽列的「過往活動」點進去看。
 */
const canRegister = (a) => a.isOpen && !a.isFull;

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

    fillActivities(
      $('#upcoming'), open, today,
      '目前沒有開放報名的活動',
      '之後有新活動會出現在這裡，記得回來看看。',
    );

    // 沒有截止或額滿的活動時，整個區塊就不要出現
    $('#closed-section').hidden = closed.length === 0;
    if (closed.length) fillActivities($('#closed'), closed, today, '', '');

    // 過往活動不在首頁出現，導覽列的「過往活動」點進去看就好
  } catch (err) {
    $('#upcoming').innerHTML = '';
    showNotice($('#notice'), 'error', err.message);
  }
})();
