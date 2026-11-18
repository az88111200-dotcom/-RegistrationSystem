import { el, formatDate, activityStatus } from './common.js';

/*
 * 貼紙的底色與小圖示：照活動名稱裡的字猜類別（純裝飾，猜不到就用星星）。
 * 顏色輪流用，同一頁上相鄰的兩張不會同色。
 */
const svg = (d) => `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICONS = [
  [/音|樂|團|吉他|鼓|唱|歌/, svg('<path d="M18 36 V12 L40 7 V31"/><path d="M18 18 L40 13"/><ellipse cx="13" cy="36" rx="5" ry="4.5"/><ellipse cx="35" cy="31" rx="5" ry="4.5"/>')],
  [/攝|相機|拍|影|照片|暗房/, svg('<rect x="6" y="14" width="36" height="26" rx="5"/><path d="M16 14 L19 8 H29 L32 14"/><circle cx="24" cy="27" r="7"/>')],
  [/餐|煮|烘焙|料理|食|吃|火鍋|披薩|點心|飲/, svg('<path d="M8 22 H40 V30 C40 37 34 40 24 40 C14 40 8 37 8 30 Z"/><path d="M4 22 H44"/><path d="M18 16 C 18 12 21 12 21 8"/><path d="M27 16 C 27 12 30 12 30 8"/>')],
  [/繪|畫|彩|藝|手作|美|油漆|設計|DIY/i, svg('<path d="M28 6 L42 20 L26 30 L18 22 Z"/><path d="M18 22 C 10 24 10 32 8 40 C 16 38 24 38 26 30"/>')],
  [/舞|跳|運動|球|體能|健身|攀|跑/, svg('<circle cx="27" cy="9" r="4"/><path d="M26 14 L22 27 L30 33 L28 42"/><path d="M22 27 L14 40"/><path d="M24 18 L35 12"/><path d="M24 19 L13 21"/>')],
  [/海|山|戶外|旅|淨灘|露營|走讀|參訪|獨木舟/, svg('<path d="M4 34 C 10 30 14 30 20 34 C 26 38 30 38 36 34 C 40 31 42 31 44 32"/><path d="M8 26 L18 12 L26 22 L32 16 L40 26"/>')],
];
const STAR = svg('<path d="M24 5 L29 18 L43 19 L32 28 L36 42 L24 34 L12 42 L16 28 L5 19 L19 18 Z"/>');
const COLORS = ['var(--orange)', 'var(--sky)', 'var(--leaf-300)', 'var(--lilac)', 'var(--pink)', 'var(--sun)'];
export function activityIcon(title) {
  return (ICONS.find(([re]) => re.test(String(title || ''))) || [null, STAR])[1];
}

/** 卡片右側的狀態標籤。 */
function statusBadge(activity, today) {
  const status = activityStatus(activity, today);
  const badge = {
    past: ['badge-past', '已結束'],
    // 額滿但還收候補：講「候補中」比「已額滿」有用，少年才知道還能報
    waitlist: ['badge-wait', '候補中'],
    full: ['badge-full', '已額滿'],
    closed: ['badge-closed', '已截止'],
    // 已經開課但還沒結束 —— 連續性團體可以中途加入
    started: ['badge-soon', '已開課・可加入'],
    today: ['badge-soon', '就是今天'],
    soon: ['badge-soon', `剩 ${status.days} 天`],
    open: ['badge-open', '開放報名'],
  }[status.key];
  return el('span', { class: `badge ${badge[0]}`, text: badge[1] });
}

/**
 * 一張活動卡片。首頁與過往活動頁共用。
 *
 * 刻意做成一列的緊湊樣式：日期、名稱、地點、狀態各佔一小塊就好。
 * 詳細說明留在活動自己的頁面，列表上不重複展開，
 * 活動多的時候才不用一直往下滑。
 */
export function activityCard(activity, today, index = 0) {
  // 已結束 / 已截止 / 額滿（連候補也不收）的卡片畫得淡一點，讓可以報名的活動先被看到；
  // 還收候補的不淡掉 —— 它還是可以報名
  const unavailable = !activity.isPast
    && (!activity.isOpen || (activity.isFull && !activity.acceptingWaitlist));
  const classes = ['activity-card'];
  if (activity.isPast) classes.push('is-past');
  else if (unavailable) classes.push('is-unavailable');

  // 連續性課程顯示「7/01 - 8/26 共 9 堂」，單日活動維持原樣
  const isSeries = activity.endDate && activity.endDate !== activity.eventDate;
  const when = isSeries
    ? `${formatDate(activity.eventDate)} - ${activity.endDate.slice(5).replace('-', '/')}`
      + (activity.sessionCount ? `　共 ${activity.sessionCount} 堂` : '')
    : formatDate(activity.eventDate) + (activity.eventTime ? `　${activity.eventTime}` : '');


  // 左邊的圓形徽章放類別圖示（日期已經寫在名稱下面，不再重複；
  // 連續課程只放第一堂的日期反而會讓人以為已經結束）
  const stamp = el('span', { class: 'ac-stamp', 'aria-hidden': 'true' });
  stamp.innerHTML = activityIcon(activity.title);

  return el('a', {
    class: classes.join(' '),
    href: `/activity/${encodeURIComponent(activity.slug)}`,
    style: `--f:${COLORS[index % COLORS.length]}`,
  }, [
    stamp,
    el('span', { class: 'ac-body' }, [
      el('span', { class: 'ac-title', text: activity.title }),
      // 時間一行、地點一行
      el('span', { class: 'ac-meta' }, [
        el('span', { class: 'ac-when', text: when }),
        activity.location || activity.venueName
          ? el('span', { class: 'ac-where', text: activity.location || activity.venueName })
          : null,
      ]),
    ]),
    // 右邊只留狀態標籤。已經有幾個人報名不對外顯示 ——
    // 開放報名／已額滿／候補中這幾個狀態就足夠讓少年知道還能不能報。
    el('span', { class: 'ac-side' }, [
      statusBadge(activity, today),
      // 選天數報名：讓人在列表上就知道不用每一天都來
      activity.pickDays ? el('span', { class: 'badge badge-pick', text: '📅 可選天數參加' }) : null,
    ]),
  ]);
}

/** 預設先顯示幾筆，其餘收在「查看更多」後面。 */
const DEFAULT_LIMIT = 3;

/**
 * 把活動塞進容器。
 * 超過 limit 的部分先收起來，按「查看更多」才展開，
 * 這樣即使活動很多，首頁也不會變得很長。
 */
export function fillActivities(container, activities, today, emptyTitle, emptyHint, options = {}) {
  const limit = options.limit ?? DEFAULT_LIMIT;
  container.innerHTML = '';

  if (!activities.length) {
    if (emptyTitle) {
      container.append(el('div', { class: 'empty' }, [
        el('strong', { text: emptyTitle }),
        emptyHint,
      ]));
    }
    return;
  }

  const visible = activities.slice(0, limit);
  const hidden = activities.slice(limit);
  visible.forEach((activity, i) => container.append(activityCard(activity, today, i)));

  if (!hidden.length) return;

  const rest = el('div', { class: 'activity-list activity-more', hidden: true });
  hidden.forEach((activity, i) => rest.append(activityCard(activity, today, i + limit)));

  const toggle = el('button', {
    type: 'button', class: 'btn btn-ghost btn-block more-btn',
    text: `查看更多（還有 ${hidden.length} 個）`,
    onClick: () => {
      const opening = rest.hidden;
      rest.hidden = !opening;
      toggle.textContent = opening ? '收合' : `查看更多（還有 ${hidden.length} 個）`;
      if (opening) options.onMore?.(rest);
    },
  });

  container.append(rest, toggle);
}
