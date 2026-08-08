import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR, DB_FILE, BACKUP_DIR } from './config.js';
import { newId, nowInTaipei, slugify } from './util.js';

const EMPTY_DB = { version: 1, activities: [], students: [], registrations: [] };

let db = null;

function ensureDirs() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

/** 首次啟動時放一個範例活動，讓工作人員一進後台就看得到系統怎麼運作。 */
function seedDb() {
  const seeded = structuredClone(EMPTY_DB);
  seeded.activities.push({
    id: newId(),
    slug: slugify('sea-kayak-beach-cleanup'),
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
    closed: false,
    createdAt: nowInTaipei(),
  });
  return seeded;
}

/** 讀取資料庫（第一次呼叫時載入，之後常駐在記憶體）。 */
export function getDb() {
  if (db) return db;
  ensureDirs();
  try {
    const raw = fs.readFileSync(DB_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    db = { ...structuredClone(EMPTY_DB), ...parsed };
  } catch (err) {
    if (err.code !== 'ENOENT') {
      // 檔案壞掉時保留原檔，不要覆蓋掉可能救得回來的資料。
      const rescue = path.join(BACKUP_DIR, `db.corrupt.${Date.now()}.json`);
      try { fs.copyFileSync(DB_FILE, rescue); } catch { /* 原檔可能不存在 */ }
      throw new Error(`資料檔 ${DB_FILE} 無法解析，已備份到 ${rescue}。請修復後再啟動。`);
    }
    db = seedDb();
    persist();
  }
  return db;
}

/**
 * 原子寫入：先寫暫存檔再 rename，避免寫到一半斷電造成資料檔壞掉。
 */
export function persist() {
  ensureDirs();
  const tmp = `${DB_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(tmp, DB_FILE);
}

/** 修改資料的統一入口：跑完 mutator 就立刻落地。 */
export function mutate(fn) {
  const current = getDb();
  const result = fn(current);
  persist();
  return result;
}

/** 每天第一次寫入時留一份備份，最多保留 30 份。 */
export function backupDaily() {
  ensureDirs();
  if (!fs.existsSync(DB_FILE)) return;
  const stamp = nowInTaipei().slice(0, 10);
  const target = path.join(BACKUP_DIR, `db.${stamp}.json`);
  if (fs.existsSync(target)) return;
  fs.copyFileSync(DB_FILE, target);
  const files = fs.readdirSync(BACKUP_DIR)
    .filter((f) => /^db\.\d{4}-\d{2}-\d{2}\.json$/.test(f))
    .sort();
  for (const stale of files.slice(0, Math.max(0, files.length - 30))) {
    fs.unlinkSync(path.join(BACKUP_DIR, stale));
  }
}
