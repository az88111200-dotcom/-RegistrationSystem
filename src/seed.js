import { query } from './db.js';
import { createActivity } from './model.js';

/**
 * 資料庫是空的時候放一個範例活動，
 * 讓工作人員第一次進後台就看得到系統長什麼樣子。不要的話直接刪掉即可。
 */
export async function seedIfEmpty() {
  const { rows } = await query('SELECT COUNT(*) AS n FROM activities');
  if (Number(rows[0].n) > 0) return false;

  await createActivity({
    title: '向海出發~淨灘 x 獨木舟，划出少年的熱血夏天！',
    summary: '厭倦了千篇一律的暑假？想為自己的青春留下點不一樣的印記？是時候跟著我們一起「浪」跡天涯了！',
    description: [
      '【活動資訊】',
      '對象：居住或學籍於新北市 14-18 歲少年',
      '',
      '【當日流程】',
      '08:00-09:30 培力園集合，搭車前往貢寮沙灘（08:10 準時出發，逾時不候）',
      '09:30-10:00 抵達龍門舊社沙灘、行前說明',
      '10:00-12:00 淨灘行動',
      '12:00-13:30 午餐與休息',
      '13:30-16:30 獨木舟體驗',
      '16:30-19:00 收拾整隊、返回培力園解散',
      '',
      '名額有限，錯過等一年！',
    ].join('\n'),
    eventDate: '2026-08-14',
    eventTime: '08:00-19:00',
    location: '新北市貢寮區 龍門舊社沙灘',
    gatheringPlace: '新北市泰山區明志路一段350號',
    capacity: 30,
    registrationDeadline: '2026-08-12',
    contact: '洽詢電話：02-2297-7113 王社工｜少年培力園 LINE ID：pilot.cafe',
    slug: 'sea-kayak-beach-cleanup',
  });
  return true;
}
