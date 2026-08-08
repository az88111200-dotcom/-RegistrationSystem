// 資料庫存取層：SQL 資料列 ⇄ 系統內部使用的物件。
// 商業邏輯放在 model.js，這裡只負責讀寫。

import { query } from './db.js';
import { STUDENT_FIELDS } from './fields.js';
import { toRocDate } from './util.js';

const STUDENT_KEYS = STUDENT_FIELDS.map((f) => f.key);

// ---------------------------------------------------------------- 轉換

export function rowToActivity(row) {
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    summary: row.summary,
    description: row.description,
    eventDate: row.event_date,
    eventTime: row.event_time,
    location: row.location,
    gatheringPlace: row.gathering_place,
    capacity: row.capacity,
    registrationDeadline: row.registration_deadline || '',
    contact: row.contact,
    closed: row.closed,
    createdAt: row.created_at,
    // 有 JOIN 統計時才會有這個欄位
    registrationCount: row.registration_count === undefined
      ? undefined : Number(row.registration_count),
  };
}

/**
 * 學生資料欄位存在 profile JSONB 裡，
 * 但身分證、姓名、生日另外開欄位，才能建唯一索引與加速查詢。
 */
export function rowToStudent(row) {
  if (!row) return null;
  const student = {
    id: row.id,
    ...row.profile,
    idNumber: row.id_number,
    name: row.name,
    birthDate: row.birth_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.registration_count !== undefined) {
    student.registrationCount = Number(row.registration_count);
  }
  if (row.last_registered_at !== undefined) {
    student.lastRegisteredAt = row.last_registered_at || '';
  }
  return student;
}

export function rowToRegistration(row) {
  if (!row) return null;
  return {
    id: row.id,
    activityId: row.activity_id,
    studentId: row.student_id,
    answers: row.answers,
    ageAtEvent: row.age_at_event,
    note: row.note,
    registeredAt: row.registered_at,
  };
}

/** 只保留欄位定義裡有的鍵，避免前端塞進來的雜訊被存進資料庫。 */
function toProfile(data) {
  const profile = {};
  for (const key of STUDENT_KEYS) profile[key] = data[key] ?? '';
  profile.familyStatus = Array.isArray(data.familyStatus) ? data.familyStatus : [];
  return profile;
}

/**
 * 組出後台搜尋要比對的字串。
 * 除了原始欄位，也把民國生日算進去 —— 社工習慣講「99 年次」，
 * 直接輸入 99/10/14 就要查得到人。
 */
function buildSearchText(data) {
  return [
    ...STUDENT_KEYS.map((k) => (Array.isArray(data[k]) ? data[k].join(' ') : data[k] ?? '')),
    toRocDate(data.birthDate),
    toRocDate(data.guardianBirthDate),
  ].join(' ').toLowerCase();
}

// ---------------------------------------------------------------- 活動

const ACTIVITY_SELECT = `
  SELECT a.*, COALESCE(r.n, 0) AS registration_count
  FROM activities a
  LEFT JOIN (
    SELECT activity_id, COUNT(*) AS n FROM registrations GROUP BY activity_id
  ) r ON r.activity_id = a.id
`;

export async function allActivities() {
  const { rows } = await query(`${ACTIVITY_SELECT} ORDER BY a.event_date DESC`);
  return rows.map(rowToActivity);
}

export async function findActivityRow(idOrSlug, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(`${ACTIVITY_SELECT} WHERE a.id = $1 OR a.slug = $1 LIMIT 1`, [idOrSlug]);
  return rowToActivity(rows[0]);
}

export async function slugExists(slug, excludeId = null) {
  const { rows } = await query(
    'SELECT 1 FROM activities WHERE slug = $1 AND ($2::text IS NULL OR id <> $2) LIMIT 1',
    [slug, excludeId],
  );
  return rows.length > 0;
}

export async function insertActivity(a) {
  await query(
    `INSERT INTO activities
       (id, slug, title, summary, description, event_date, event_time, location,
        gathering_place, capacity, registration_deadline, contact, closed, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,'')::date,$12,$13,$14)`,
    [a.id, a.slug, a.title, a.summary, a.description, a.eventDate, a.eventTime,
      a.location, a.gatheringPlace, a.capacity, a.registrationDeadline, a.contact,
      a.closed, a.createdAt],
  );
  return findActivityRow(a.id);
}

export async function updateActivityRow(id, a) {
  await query(
    `UPDATE activities SET
       slug = $2, title = $3, summary = $4, description = $5, event_date = $6,
       event_time = $7, location = $8, gathering_place = $9, capacity = $10,
       registration_deadline = NULLIF($11,'')::date, contact = $12, closed = $13
     WHERE id = $1`,
    [id, a.slug, a.title, a.summary, a.description, a.eventDate, a.eventTime,
      a.location, a.gatheringPlace, a.capacity, a.registrationDeadline, a.contact,
      a.closed],
  );
  return findActivityRow(id);
}

/** 刪除活動。報名紀錄靠外鍵 ON DELETE CASCADE 一起刪，學生主檔保留。 */
export async function deleteActivityRow(id) {
  const { rows } = await query(
    'SELECT (SELECT COUNT(*) FROM registrations WHERE activity_id = $1) AS n, title FROM activities WHERE id = $1',
    [id],
  );
  if (!rows.length) return null;
  await query('DELETE FROM activities WHERE id = $1', [id]);
  return { deleted: rows[0].title, removedRegistrations: Number(rows[0].n) };
}

// ---------------------------------------------------------------- 學生

const STUDENT_SELECT = `
  SELECT s.*, COALESCE(r.n, 0) AS registration_count, r.last_at AS last_registered_at
  FROM students s
  LEFT JOIN (
    SELECT student_id, COUNT(*) AS n, MAX(registered_at) AS last_at
    FROM registrations GROUP BY student_id
  ) r ON r.student_id = s.id
`;

export async function findStudentById(id, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(`${STUDENT_SELECT} WHERE s.id = $1`, [id]);
  return rowToStudent(rows[0]);
}

export async function findStudentByIdNumber(idNumber, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(`${STUDENT_SELECT} WHERE s.id_number = $1`, [idNumber]);
  return rowToStudent(rows[0]);
}

/** 老朋友查詢：姓名 + 身分證 + 生日三項全對才回傳。 */
export async function lookupStudentRow(name, idNumber, birthDate) {
  const { rows } = await query(
    `${STUDENT_SELECT} WHERE s.id_number = $1 AND s.name = $2 AND s.birth_date = $3::date`,
    [idNumber, name, birthDate],
  );
  return rowToStudent(rows[0]);
}

/** 以身分證字號為準新增或更新學生主檔。 */
export async function upsertStudentRow(id, data, now, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `INSERT INTO students
       (id, id_number, name, birth_date, profile, search_text, created_at, updated_at)
     VALUES ($1, $2, $3, $4::date, $5::jsonb, $6, $7, $7)
     ON CONFLICT (id_number) DO UPDATE SET
       name = EXCLUDED.name,
       birth_date = EXCLUDED.birth_date,
       profile = EXCLUDED.profile,
       search_text = EXCLUDED.search_text,
       updated_at = EXCLUDED.updated_at
     RETURNING id`,
    [id, data.idNumber, data.name, data.birthDate,
      JSON.stringify(toProfile(data)), buildSearchText(data), now],
  );
  return findStudentById(rows[0].id, client);
}

export async function updateStudentRow(id, data, now) {
  await query(
    `UPDATE students SET id_number = $2, name = $3, birth_date = $4::date,
            profile = $5::jsonb, search_text = $6, updated_at = $7
     WHERE id = $1`,
    [id, data.idNumber, data.name, data.birthDate,
      JSON.stringify(toProfile(data)), buildSearchText(data), now],
  );
  return findStudentById(id);
}

export async function deleteStudentRow(id) {
  const { rows } = await query(
    'SELECT name, (SELECT COUNT(*) FROM registrations WHERE student_id = $1) AS n FROM students WHERE id = $1',
    [id],
  );
  if (!rows.length) return null;
  await query('DELETE FROM students WHERE id = $1', [id]);
  return { deleted: rows[0].name, removedRegistrations: Number(rows[0].n) };
}

/**
 * 學生總表搜尋。
 * 把所有可能被搜尋的欄位串成一段文字再比對，
 * 這樣姓名、身分證、學校、電話、監護人、民國生日都搜得到。
 */
export async function searchStudentRows(q) {
  if (!q) {
    const { rows } = await query(
      `${STUDENT_SELECT} ORDER BY COALESCE(r.last_at, s.created_at) DESC`,
    );
    return rows.map(rowToStudent);
  }
  const { rows } = await query(
    `${STUDENT_SELECT}
     WHERE s.search_text LIKE '%' || lower($1) || '%'
        OR s.birth_date::text LIKE '%' || $1 || '%'
     ORDER BY COALESCE(r.last_at, s.created_at) DESC`,
    [q],
  );
  return rows.map(rowToStudent);
}

// ---------------------------------------------------------------- 報名

export async function countRegistrations(activityId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    'SELECT COUNT(*) AS n FROM registrations WHERE activity_id = $1', [activityId],
  );
  return Number(rows[0].n);
}

export async function hasRegistered(activityId, studentId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    'SELECT 1 FROM registrations WHERE activity_id = $1 AND student_id = $2 LIMIT 1',
    [activityId, studentId],
  );
  return rows.length > 0;
}

export async function insertRegistration(r, client = null) {
  const run = client ? client.query.bind(client) : query;
  await run(
    `INSERT INTO registrations
       (id, activity_id, student_id, answers, age_at_event, note, registered_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7)`,
    [r.id, r.activityId, r.studentId, JSON.stringify(r.answers),
      r.ageAtEvent, r.note, r.registeredAt],
  );
  return r;
}

export async function findRegistration(id) {
  const { rows } = await query('SELECT * FROM registrations WHERE id = $1', [id]);
  return rowToRegistration(rows[0]);
}

export async function deleteRegistrationRow(id) {
  const { rows } = await query(
    `DELETE FROM registrations r USING students s
     WHERE r.id = $1 AND s.id = r.student_id
     RETURNING s.name`,
    [id],
  );
  return rows.length ? { deleted: rows[0].name } : null;
}

export async function setRegistrationNoteRow(id, note) {
  const { rowCount } = await query('UPDATE registrations SET note = $2 WHERE id = $1', [id, note]);
  return rowCount > 0;
}

/** 某個活動的完整報名名冊，含學生資料，依報名時間排序。 */
export async function rosterRows(activityId) {
  const { rows } = await query(
    `SELECT r.*, s.id_number, s.name, s.birth_date, s.profile, s.created_at AS student_created_at
     FROM registrations r
     JOIN students s ON s.id = r.student_id
     WHERE r.activity_id = $1
     ORDER BY r.registered_at ASC`,
    [activityId],
  );
  return rows;
}

/** 某位學生報名過哪些活動。 */
export async function studentHistoryRows(studentId) {
  const { rows } = await query(
    `SELECT r.id AS registration_id, r.registered_at,
            a.id AS activity_id, a.slug, a.title, a.event_date
     FROM registrations r
     JOIN activities a ON a.id = r.activity_id
     WHERE r.student_id = $1
     ORDER BY a.event_date DESC`,
    [studentId],
  );
  return rows;
}

export async function statsRow() {
  const { rows } = await query(`
    SELECT
      (SELECT COUNT(*) FROM activities)     AS activities,
      (SELECT COUNT(*) FROM students)       AS students,
      (SELECT COUNT(*) FROM registrations)  AS registrations
  `);
  return rows[0];
}

// ---------------------------------------------------------------- 登入次數

const WINDOW_MS = 15 * 60 * 1000;

export async function recordLoginFailure(ip) {
  await query(
    `INSERT INTO login_attempts (ip, count, first_at) VALUES ($1, 1, $2)
     ON CONFLICT (ip) DO UPDATE SET
       count    = CASE WHEN $2 - login_attempts.first_at > $3 THEN 1
                       ELSE login_attempts.count + 1 END,
       first_at = CASE WHEN $2 - login_attempts.first_at > $3 THEN $2
                       ELSE login_attempts.first_at END`,
    [ip, Date.now(), WINDOW_MS],
  );
}

export async function loginFailureCount(ip) {
  const { rows } = await query('SELECT count, first_at FROM login_attempts WHERE ip = $1', [ip]);
  if (!rows.length) return 0;
  if (Date.now() - Number(rows[0].first_at) > WINDOW_MS) return 0;
  return rows[0].count;
}

export async function clearLoginFailures(ip) {
  await query('DELETE FROM login_attempts WHERE ip = $1', [ip]);
}
