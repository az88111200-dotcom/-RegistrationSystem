import { el, formatDate, dateChip, daysUntil } from './common.js';

/** 卡片右側的狀態標籤。 */
function statusBadge(activity, today) {
  const left = daysUntil(activity.eventDate, today);
  if (activity.isPast) return el('span', { class: 'badge badge-past', text: '已結束' });
  // 額滿但還收候補：講「候補中」比「已額滿」有用，少年才知道還能報
  if (activity.isFull && activity.isOpen && activity.acceptingWaitlist) {
    return el('span', { class: 'badge badge-wait', text: '候補中' });
  }
  if (activity.isFull) return el('span', { class: 'badge badge-full', text: '已額滿' });
  if (!activity.isOpen) return el('span', { class: 'badge badge-closed', text: '已截止' });
  if (left !== null && left <= 7) {
    return el('span', { class: 'badge badge-soon', text: left === 0 ? '就是今天' : `剩 ${left} 天` });
  }
  return el('span', { class: 'badge badge-open', text: '開放報名' });
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

  // 名額與候補都寫出來，讓人一眼看懂現在的狀況
  let seats = activity.capacity > 0
    ? `${activity.registrationCount} / ${activity.capacity} 人`
    : `${activity.registrationCount} 人報名`;
  if (activity.waitlistCount > 0) seats += `　候補 ${activity.waitlistCount} 人`;

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
    el('span', { class: 'ac-side' }, [
      statusBadge(activity, today),
      el('span', { class: 'ac-seats', text: seats }),
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
