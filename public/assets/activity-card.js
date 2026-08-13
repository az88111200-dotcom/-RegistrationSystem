import { el, formatDate, dateChip, activityStatus } from './common.js';

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
export function activityCard(activity, today) {
  const chip = dateChip(activity.eventDate);

  // 已結束 / 已截止 / 額滿的卡片畫得淡一點，讓可以報名的活動先被看到
  const unavailable = !activity.isPast && (!activity.isOpen || activity.isFull);
  const classes = ['activity-card'];
  if (activity.isPast) classes.push('is-past');
  else if (unavailable) classes.push('is-unavailable');

  // 連續性課程顯示「7/01 - 8/26 共 9 堂」，單日活動維持原樣
  const isSeries = activity.endDate && activity.endDate !== activity.eventDate;
  const when = isSeries
    ? `${formatDate(activity.eventDate)} - ${activity.endDate.slice(5).replace('-', '/')}`
      + (activity.sessionCount ? `　共 ${activity.sessionCount} 堂` : '')
    : formatDate(activity.eventDate) + (activity.eventTime ? `　${activity.eventTime}` : '');


  return el('a', {
    class: classes.join(' '),
    href: `/activity/${encodeURIComponent(activity.slug)}`,
  }, [
    el('span', { class: 'date-chip' }, [
      el('span', { class: 'd', text: chip.d }),
      el('span', { class: 'm', text: chip.m }),
    ]),
    el('span', { class: 'ac-body' }, [
      el('span', { class: 'ac-title', text: activity.title }),
      // 地點另外包一層，手機版空間不夠時整段藏起來（詳情頁看得到）
      el('span', { class: 'ac-meta' }, [
        el('span', { class: 'ac-when', text: when }),
        activity.location
          ? el('span', { class: 'ac-where', text: `　·　${activity.location}` })
          : null,
      ]),
    ]),
    // 右邊只留狀態標籤。已經有幾個人報名不對外顯示 ——
    // 開放報名／已額滿／候補中這幾個狀態就足夠讓少年知道還能不能報。
    el('span', { class: 'ac-side' }, [
      statusBadge(activity, today),
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
  for (const activity of visible) container.append(activityCard(activity, today));

  if (!hidden.length) return;

  const rest = el('div', { class: 'activity-list activity-more', hidden: true });
  for (const activity of hidden) rest.append(activityCard(activity, today));

  const toggle = el('button', {
    type: 'button', class: 'btn btn-ghost btn-block more-btn',
    text: `查看更多（還有 ${hidden.length} 個）`,
    onClick: () => {
      const opening = rest.hidden;
      rest.hidden = !opening;
      toggle.textContent = opening ? '收合' : `查看更多（還有 ${hidden.length} 個）`;
    },
  });

  container.append(rest, toggle);
}
