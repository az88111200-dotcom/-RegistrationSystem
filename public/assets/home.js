import { api, $, el, showNotice } from './common.js';
import { fillActivities, activityCard } from './activity-card.js';
import * as motion from './motion.js';

/**
 * 活動總覽把活動分成三區，用上面的分頁切換：
 *   1. 開放報名中 —— 還沒舉行、還在開放報名（額滿的也在這裡：可以排候補，
 *      或至少看得到這個活動還在；排在還有名額的後面）
 *   2. 已截止 —— 還沒舉行，但過了截止日或被工作人員關閉
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
    ['closed', '已截止'],
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

/**
 * 電腦版主視覺右邊的「下一個活動」：最近一個還能報名的活動。
 * 手機版用 CSS 藏起來（往下滑就是活動清單，不用重複）。
 */
function nextUp(activity, today) {
  const box = $('#next-up');
  if (!activity || !box) return;
  box.append(el('span', { class: 'next-label', text: '下一個活動' }), activityCard(activity, today, 0));
  box.hidden = false;
}

/** 跑馬燈：還沒結束的活動名稱接成一圈（為了無縫接回去，同一串放兩次）。 */
function fillMarquee(list) {
  const track = $('#marquee');
  if (!track || !list.length) return;
  const star = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 0 C11 7 13 9 20 10 C13 11 11 13 10 20 C9 13 7 11 0 10 C7 9 9 7 10 0Z" fill="currentColor"/></svg>';
  const names = list.map((a) => a.title);
  while (names.length < 4) names.push(...names);
  for (const name of [...names, ...names]) {
    const item = el('span', { text: name });
    item.insertAdjacentHTML('beforeend', star);
    track.append(item);
  }
  track.parentElement.hidden = false;
}

/** 首頁的動畫：標題彈出來、螢光筆刷過去、飛機飛進來、捲到的活動貼上來。 */
function animate() {
  document.getElementById('go-list')?.addEventListener('click', (e) => {
    e.preventDefault();
    motion.scrollToEl(document.getElementById('tabs'), { offset: 20 });
  });
  motion.popIn(document.querySelectorAll('.hero-title .ln'));
  motion.sweep(document.querySelectorAll('.hero-title .mark'), { delay: .45 });
  motion.plane(document.querySelector('.hero-plane'), document.querySelector('.hero'));
  motion.slap(document.querySelectorAll('#next-up .activity-card'), .45);
  motion.marquee($('#marquee'));
  motion.slapOnScroll(document.querySelectorAll('#open-section .activity-card'));
}

(async () => {
  try {
    const [{ activities }, schema] = await Promise.all([
      api('/api/activities'),
      api('/api/form-schema'),
    ]);
    const { today } = schema;

    const upcoming = activities.filter((a) => !a.isPast);
    // 額滿的還是放在開放報名中，只是排在還有名額的後面（sort 是穩定的，同一組維持原本的日期順序）
    const open = upcoming.filter((a) => a.isOpen)
      .sort((a, b) => Number(!canRegister(a)) - Number(!canRegister(b)));
    const closed = upcoming.filter((a) => !a.isOpen);
    const past = activities.filter((a) => a.isPast);

    // 開放報名中、已截止：活動不多，全部直接列出來，不收在「查看更多」後面
    fillActivities(
      $('#upcoming'), open, today,
      '目前沒有開放報名的活動',
      '之後有新活動會出現在這裡，記得回來看看。',
      { limit: Infinity },
    );
    fillActivities($('#closed'), closed, today, '沒有已截止的活動', '', { limit: Infinity });
    // 已結束的會越來越多，維持先列幾個，其餘收在「查看更多」
    fillActivities($('#past'), past, today, '還沒有結束的活動', '');

    const sections = {
      open: $('#open-section'),
      closed: $('#closed-section'),
      past: $('#past-section'),
    };
    const show = (key, animate = true) => {
      for (const [name, section] of Object.entries(sections)) section.hidden = name !== key;
      if (animate) motion.slap(sections[key].querySelectorAll(':scope > .activity-list > .activity-card'));
      motion.refresh();
    };
    renderTabs({ open: open.length, closed: closed.length, past: past.length }, show);
    show('open', false);
    nextUp(open.find(canRegister), today);
    fillMarquee(upcoming);
    animate();
  } catch (err) {
    $('#upcoming').innerHTML = '';
    showNotice($('#notice'), 'error', err.message);
  }
})();
