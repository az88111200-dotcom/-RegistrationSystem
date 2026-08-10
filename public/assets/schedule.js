/*
 * 排課日期的計算。
 *
 * 這個檔案前後端共用：後台的日期挑選器要立刻算出日期給工作人員看，
 * 後端存檔時也要用同一套規則驗算。放在同一個檔案，兩邊就不可能算出不同結果。
 * 因此這裡只能有純粹的日期計算 —— 不碰 DOM，也不碰資料庫。
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** 場次上限。兩年份的每日課程已經是極限，避免日期填錯灌爆資料庫。 */
export const MAX_SESSIONS = 400;

export const WEEKDAY_NAMES = ['日', '一', '二', '三', '四', '五', '六'];

/** 把日期字串加上天數，回傳 YYYY-MM-DD。 */
export function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 星期幾（0=日 … 6=六）。 */
export function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/** 兩個日期相差幾天。 */
export function daysBetween(from, to) {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000,
  );
}

/** 2026-07-01 → 7/01（三） */
export function shortDate(iso) {
  if (!DATE_RE.test(iso)) return iso;
  return `${Number(iso.slice(5, 7))}/${iso.slice(8, 10)}（${WEEKDAY_NAMES[weekdayOf(iso)]}）`;
}

/**
 * 依照規律排出上課日期。
 *
 *   pattern 'daily'   連續每一天（三天兩夜營隊）
 *   pattern 'weekly'  每週固定星期（水電課每週三）
 *   pattern 'biweekly' 隔週的固定星期（隔週三的成長團體）
 *
 * weekdays 是 0-6 的陣列。weekly/biweekly 沒給星期時，
 * 自動沿用開始日期那一天的星期 —— 這通常就是工作人員想要的。
 *
 * 隔週是以「開始日期所在的那一週」為第 0 週往後數，
 * 所以第一堂一定會排到，不會因為開始日在週末而整週被跳掉。
 *
 * 回傳排序過、不重複的日期陣列；算不出任何日期時回傳空陣列，
 * 由呼叫端決定要怎麼提示（前端顯示訊息、後端丟錯誤）。
 */
export function datesByPattern(startDate, endDate, pattern = 'daily', weekdays = []) {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) return [];
  if (endDate < startDate) return [];

  const everyNWeeks = pattern === 'biweekly' ? 2 : 1;
  let wanted = new Set(
    (weekdays || []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6),
  );
  if (pattern !== 'daily' && !wanted.size) wanted = new Set([weekdayOf(startDate)]);

  // 第 0 週的週日，用來判斷某一天落在第幾週
  const weekOrigin = addDays(startDate, -weekdayOf(startDate));

  const dates = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    if (pattern !== 'daily') {
      if (!wanted.has(weekdayOf(d))) continue;
      if (everyNWeeks > 1) {
        const week = Math.floor(daysBetween(weekOrigin, d) / 7);
        if (week % everyNWeeks !== 0) continue;
      }
    }
    dates.push(d);
    if (dates.length > MAX_SESSIONS) return dates;   // 由呼叫端判斷超量
  }
  return dates;
}

/** 整理使用者給的日期清單：格式檢查、去重、排序。 */
export function normalizeDates(list) {
  const seen = new Set();
  for (const raw of [].concat(list || [])) {
    const date = String(raw || '').trim();
    if (!DATE_RE.test(date)) continue;
    seen.add(date);
  }
  return [...seen].sort();
}

/**
 * 把一串日期講成人話，例如「共 9 堂，每週三」。
 * 排課面板與活動卡片都用這個，講法才會一致。
 */
export function describeDates(dates) {
  if (!dates.length) return '';
  if (dates.length === 1) return shortDate(dates[0]);

  const weekdays = [...new Set(dates.map(weekdayOf))];
  let rhythm = '';
  if (weekdays.length === 1) {
    // 間隔固定的話再細分是每週還是隔週
    const gaps = new Set(dates.slice(1).map((d, i) => daysBetween(dates[i], d)));
    const only = gaps.size === 1 ? [...gaps][0] : 0;
    if (only === 7) rhythm = `，每週${WEEKDAY_NAMES[weekdays[0]]}`;
    else if (only === 14) rhythm = `，隔週${WEEKDAY_NAMES[weekdays[0]]}`;
    else rhythm = `，都在週${WEEKDAY_NAMES[weekdays[0]]}`;
  } else if (daysBetween(dates[0], dates[dates.length - 1]) === dates.length - 1) {
    rhythm = '，連續每一天';
  }
  return `共 ${dates.length} 堂${rhythm}`;
}
