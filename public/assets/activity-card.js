import { el, formatDate, dateChip, daysUntil } from './common.js';

/**
 * 一張活動卡片。首頁與過往活動頁共用。
 * 點下去會到該活動自己的子頁面 /activity/<slug>。
 */
export function activityCard(activity, today) {
  const chip = dateChip(activity.eventDate);
  const left = daysUntil(activity.eventDate, today);

  let badge;
  if (activity.isPast) badge = el('span', { class: 'badge badge-past', text: '已結束' });
  else if (activity.isFull) badge = el('span', { class: 'badge badge-full', text: '已額滿' });
  else if (!activity.isOpen) badge = el('span', { class: 'badge badge-closed', text: '已截止報名' });
  else if (left !== null && left <= 7) {
    badge = el('span', { class: 'badge badge-soon', text: left === 0 ? '就是今天' : `剩 ${left} 天` });
  } else badge = el('span', { class: 'badge badge-open', text: '開放報名' });

  const meta = el('div', { class: 'meta' }, [
    el('span', {}, [el('b', { text: '日期' }), formatDate(activity.eventDate)
      + (activity.eventTime ? ` ${activity.eventTime}` : '')]),
    activity.location ? el('span', {}, [el('b', { text: '地點' }), activity.location]) : null,
    activity.registrationDeadline && !activity.isPast
      ? el('span', {}, [el('b', { text: '截止' }), formatDate(activity.registrationDeadline)])
      : null,
  ]);

  const seats = activity.capacity > 0
    ? `${activity.registrationCount} / ${activity.capacity} 人`
    : `${activity.registrationCount} 人報名`;

  // 已結束 / 已截止 / 額滿的卡片會被畫得淡一點，讓可以報名的活動先被看到
  const unavailable = !activity.isPast && (!activity.isOpen || activity.isFull);
  const classes = ['activity-card'];
  if (activity.isPast) classes.push('is-past');
  else if (unavailable) classes.push('is-unavailable');

  return el('a', {
    class: classes.join(' '),
    href: `/activity/${encodeURIComponent(activity.slug)}`,
  }, [
    el('div', { class: 'row', style: 'gap:12px;align-items:flex-start' }, [
      el('div', { class: 'date-chip' }, [
        el('span', { class: 'd', text: chip.d }),
        el('span', { class: 'm', text: chip.m }),
      ]),
      el('div', { style: 'flex:1;min-width:0' }, [el('h3', { text: activity.title })]),
    ]),
    meta,
    activity.summary ? el('p', { class: 'summary', text: activity.summary }) : null,
    el('div', { class: 'foot' }, [badge, el('span', { class: 'spacer' }), seats]),
  ]);
}

/** 把活動塞進容器，沒有活動時顯示空狀態。 */
export function fillActivities(container, activities, today, emptyTitle, emptyHint) {
  container.innerHTML = '';
  if (!activities.length) {
    container.append(el('div', { class: 'empty', style: 'grid-column:1/-1' }, [
      el('strong', { text: emptyTitle }),
      emptyHint,
    ]));
    return;
  }
  for (const activity of activities) container.append(activityCard(activity, today));
}
