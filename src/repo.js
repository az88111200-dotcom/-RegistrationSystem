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
    programCategory: row.program_category || '',
    serviceType: row.service_type || '',
    subCategory: row.sub_category || '',
    endDate: row.end_date || row.event_date,
    createdAt: row.created_at,
    waitlistOpen: row.waitlist_open !== false,
    waitlistCapacity: Number(row.waitlist_capacity) || 0,
    unlisted: row.unlisted === true,
    preSurveyOpen: row.pre_survey_open === true,
    postSurveyOpen: row.post_survey_open === true,
    minAge: Number(row.min_age) || 0,
    maxAge: Number(row.max_age) || 0,
    // 有 JOIN 統計時才會有這兩個欄位
    registrationCount: row.registration_count === undefined
      ? undefined : Number(row.registration_count),
    waitlistCount: row.waitlist_count === undefined
      ? undefined : Number(row.waitlist_count),
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
    status: row.status || 'confirmed',
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

// 正取與候補分開統計。registration_count 一律只算正取 ——
// 「報名 28 / 30 人」如果把候補也算進去，前台會看起來莫名其妙超額。
const ACTIVITY_SELECT = `
  SELECT a.*, COALESCE(r.n, 0) AS registration_count, COALESCE(r.w, 0) AS waitlist_count
  FROM activities a
  LEFT JOIN (
    SELECT activity_id,
           COUNT(*) FILTER (WHERE status <> 'waitlist') AS n,
           COUNT(*) FILTER (WHERE status = 'waitlist')  AS w
    FROM registrations GROUP BY activity_id
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
        gathering_place, capacity, registration_deadline, contact, closed,
        program_category, service_type, sub_category, created_at,
        waitlist_open, waitlist_capacity, unlisted, min_age, max_age,
        pre_survey_open, post_survey_open)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NULLIF($11,'')::date,
             $12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)`,
    [a.id, a.slug, a.title, a.summary, a.description, a.eventDate, a.eventTime,
      a.location, a.gatheringPlace, a.capacity, a.registrationDeadline, a.contact,
      a.closed, a.programCategory, a.serviceType, a.subCategory, a.createdAt,
      a.waitlistOpen !== false, Number(a.waitlistCapacity) || 0, a.unlisted === true,
      Number(a.minAge) || 0, Number(a.maxAge) || 0,
      a.preSurveyOpen === true, a.postSurveyOpen === true],
  );
  return findActivityRow(a.id);
}

export async function updateActivityRow(id, a) {
  await query(
    `UPDATE activities SET
       slug = $2, title = $3, summary = $4, description = $5, event_date = $6,
       event_time = $7, location = $8, gathering_place = $9, capacity = $10,
       registration_deadline = NULLIF($11,'')::date, contact = $12, closed = $13,
       program_category = $14, service_type = $15, sub_category = $16,
       waitlist_open = $17, waitlist_capacity = $18, unlisted = $19,
       min_age = $20, max_age = $21,
       pre_survey_open = $22, post_survey_open = $23
     WHERE id = $1`,
    [id, a.slug, a.title, a.summary, a.description, a.eventDate, a.eventTime,
      a.location, a.gatheringPlace, a.capacity, a.registrationDeadline, a.contact,
      a.closed, a.programCategory, a.serviceType, a.subCategory,
      a.waitlistOpen !== false, Number(a.waitlistCapacity) || 0, a.unlisted === true,
      Number(a.minAge) || 0, Number(a.maxAge) || 0,
      a.preSurveyOpen === true, a.postSurveyOpen === true],
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

/**
 * 用姓名找學生，同名的全部回傳。
 * 比對前把空白拿掉，這樣「王 小明」跟「王小明」算同一個人，
 * 現場簽到少年打字時多按到空白也不會查不到。
 */
export async function findStudentsByName(name) {
  const { rows } = await query(
    `${STUDENT_SELECT} WHERE replace(s.name, ' ', '') = $1 ORDER BY s.created_at`,
    [String(name).replace(/\s+/g, '')],
  );
  return rows.map(rowToStudent);
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

/** 正取與候補各有幾人。判斷額滿、算候補順序都靠這個。 */
export async function countRegistrations(activityId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT COUNT(*) FILTER (WHERE status <> 'waitlist') AS confirmed,
            COUNT(*) FILTER (WHERE status = 'waitlist')  AS waitlist
     FROM registrations WHERE activity_id = $1`,
    [activityId],
  );
  return { confirmed: Number(rows[0].confirmed), waitlist: Number(rows[0].waitlist) };
}

/** 候補名單最前面那一位，用來遞補。 */
export async function firstWaitlisted(activityId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    `SELECT r.id, s.name FROM registrations r JOIN students s ON s.id = r.student_id
     WHERE r.activity_id = $1 AND r.status = 'waitlist'
     ORDER BY r.registered_at ASC LIMIT 1`,
    [activityId],
  );
  return rows[0] || null;
}

/** 把某一筆報名改成正取或候補。 */
export async function setRegistrationStatus(id, status, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rowCount } = await run(
    'UPDATE registrations SET status = $2 WHERE id = $1', [id, status],
  );
  return rowCount > 0;
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
       (id, activity_id, student_id, answers, age_at_event, note, registered_at, status)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`,
    [r.id, r.activityId, r.studentId, JSON.stringify(r.answers),
      r.ageAtEvent, r.note, r.registeredAt, r.status || 'confirmed'],
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
     RETURNING s.name, r.activity_id, r.status`,
    [id],
  );
  if (!rows.length) return null;
  return {
    deleted: rows[0].name,
    activityId: rows[0].activity_id,
    status: rows[0].status,
  };
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
     ORDER BY (r.status = 'waitlist'), r.registered_at ASC`,
    [activityId],
  );
  return rows;
}

/** 某位學生報名過哪些活動。 */
export async function studentHistoryRows(studentId) {
  const { rows } = await query(
    `SELECT r.id AS registration_id, r.registered_at, r.status,
            a.id AS activity_id, a.slug, a.title, a.event_date, a.end_date,
            a.event_time, a.location,
            -- 候補的話排第幾位：同一個活動裡比自己早報名的候補有幾個
            CASE WHEN r.status = 'waitlist' THEN (
              SELECT COUNT(*) + 1 FROM registrations w
              WHERE w.activity_id = r.activity_id AND w.status = 'waitlist'
                AND w.registered_at < r.registered_at
            ) ELSE 0 END AS waitlist_position
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

// ---------------------------------------------------------------- 月報統計

/**
 * 組出月報的篩選條件。
 *
 * basis 決定「這個月」怎麼算：
 *   event        —— 依活動舉辦月份（給政府的月報通常是這個：本月辦了哪些活動、服務多少人次）
 *   registration —— 依報名送出的月份
 */
function reportFilter({ month, basis, programCategory, serviceType, subCategory }) {
  const where = [];
  const params = [];
  const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)); };

  if (month) {
    // 出席以「場次日期」歸月：連續性課程橫跨兩個月時，各月只算各月上的課
    if (basis === 'attendance') add("to_char(ss.session_date, 'YYYY-MM') = ?", month);
    else add("to_char(a.event_date, 'YYYY-MM') = ?", month);
  }
  if (programCategory) add('a.program_category = ?', programCategory);
  if (serviceType) add('a.service_type = ?', serviceType);
  if (subCategory) add('a.sub_category = ?', subCategory);

  return { clause: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

/** 報名基準：一筆報名算一人次。 */
/*
 * 報名基準：一筆報名算一人次。
 *
 * 候補的人最後不一定來得成，不能算進交給政府的服務人次，所以先濾掉。
 * 條件寫在 JOIN 的 ON 裡（內連結時等同寫在 WHERE），
 * 因為後面接的篩選條件可能整段是空的，這裡自己加 WHERE 會湊不起來。
 */
const FROM_REGISTRATIONS = `
  FROM registrations r
  JOIN activities a ON a.id = r.activity_id
  JOIN students   s ON s.id = r.student_id AND r.status <> 'waitlist'
`;

/**
 * 出席基準：一次簽到算一人次。
 * 連續性課程上了 8 堂、來了 6 次，就算 6 人次，這才是實際服務量。
 */
const FROM_ATTENDANCES = `
  FROM attendances t
  JOIN sessions   ss ON ss.id = t.session_id
  JOIN activities a  ON a.id = ss.activity_id
  JOIN students   s  ON s.id = t.student_id
`;

const reportFrom = (basis) => (basis === 'attendance' ? FROM_ATTENDANCES : FROM_REGISTRATIONS);

/**
 * 出席基準的年齡：直接用「上課那天」減生日算。
 *
 * 不沿用報名時記的年齡，因為連續性課程可能橫跨少年的生日，
 * 而且現場臨時參加的人根本沒有報名紀錄。
 */
const AGE_AT_SESSION = `
  CASE
    WHEN date_part('year', age(ss.session_date, s.birth_date)) <= 11 THEN '11歲以下'
    WHEN date_part('year', age(ss.session_date, s.birth_date)) >= 19 THEN '19歲以上'
    ELSE date_part('year', age(ss.session_date, s.birth_date))::int::text
  END`;

/** 依某個欄位分組計算人次。 */
async function countBy(expr, filter) {
  const { clause, params } = reportFilter(filter);
  const field = filter.basis === 'attendance' && expr === 'r.age_at_event'
    ? AGE_AT_SESSION
    : expr;
  const { rows } = await query(
    `SELECT COALESCE(NULLIF(${field}, ''), '（未填）') AS key, COUNT(*)::int AS count
     ${reportFrom(filter.basis)} ${clause}
     GROUP BY 1 ORDER BY count DESC, key ASC`,
    params,
  );
  return rows;
}

/**
 * 月報主查詢：居住地區、年齡、身分別各自的人次，加上總計與活動清單。
 * 「人次」＝報名筆數；同一個人報名兩個活動算兩人次，這是政府報表的算法。
 */
export async function reportStats(filter) {
  const { clause, params } = reportFilter(filter);

  const isAttendance = filter.basis === 'attendance';

  const [byDistrict, byAge, byIdentity, totals, activities] = await Promise.all([
    countBy("s.profile->>'district'", filter),
    countBy('r.age_at_event', filter),
    countBy("s.profile->>'identityType'", filter),
    query(
      `SELECT COUNT(*)::int AS registrations,
              COUNT(DISTINCT ${isAttendance ? 't.student_id' : 'r.student_id'})::int AS people,
              COUNT(DISTINCT a.id)::int AS activities,
              ${isAttendance ? 'COUNT(DISTINCT ss.id)::int' : '0'} AS sessions
       ${reportFrom(filter.basis)} ${clause}`,
      params,
    ).then((r) => r.rows[0]),
    // 活動清單另外查，才不會漏掉「有排但沒人報名」的活動
    (async () => {
      const f = reportFilter({ ...filter, basis: 'event' });
      const monthClause = filter.basis === 'registration'
        ? '' // 依報名月份時，活動清單改用有報名紀錄的活動
        : f.clause;
      if (filter.basis === 'attendance') {
        const { rows } = await query(
          `SELECT DISTINCT a.id, a.title, a.event_date, a.end_date, a.program_category,
                  a.service_type, a.sub_category,
                  (SELECT COUNT(*)::int FROM attendances x
                   JOIN sessions y ON y.id = x.session_id WHERE y.activity_id = a.id) AS n
           ${FROM_ATTENDANCES} ${clause}
           ORDER BY a.event_date DESC`,
          params,
        );
        return rows;
      }
      if (filter.basis === 'registration') {
        const { rows } = await query(
          `SELECT DISTINCT a.id, a.title, a.event_date, a.end_date, a.program_category,
                  a.service_type, a.sub_category,
                  (SELECT COUNT(*)::int FROM registrations x WHERE x.activity_id = a.id) AS n
           ${FROM_REGISTRATIONS} ${clause}
           ORDER BY a.event_date DESC`,
          params,
        );
        return rows;
      }
      const { rows } = await query(
        `SELECT a.id, a.title, a.event_date, a.end_date, a.program_category,
                a.service_type, a.sub_category,
                (SELECT COUNT(*)::int FROM registrations x WHERE x.activity_id = a.id) AS n
         FROM activities a ${monthClause}
         ORDER BY a.event_date DESC`,
        f.params,
      );
      return rows;
    })(),
  ]);

  return { byDistrict, byAge, byIdentity, totals, activities };
}

/** 有資料的月份清單，給月份下拉選單用。 */
export async function reportMonths(basis = 'event') {
  let sql;
  if (basis === 'attendance') {
    // 有排課的月份都列出來，就算還沒有人簽到也能先看
    sql = `SELECT DISTINCT to_char(session_date, 'YYYY-MM') AS month FROM sessions
           ORDER BY month DESC`;
  } else {
    sql = `SELECT DISTINCT to_char(event_date, 'YYYY-MM') AS month FROM activities
           ORDER BY month DESC`;
  }
  const { rows } = await query(sql);
  return rows.map((r) => r.month).filter(Boolean);
}

/** 目前實際用過的細分類，讓後台可以下拉挑，不用每次重打。 */
export async function usedSubCategories() {
  // 手動填入的人次也會有細分類，兩邊合起來才篩得到
  const { rows } = await query(
    `SELECT sub_category FROM activities WHERE sub_category <> ''
     UNION
     SELECT sub_category FROM manual_counts WHERE sub_category <> ''
     ORDER BY sub_category`,
  );
  return rows.map((r) => r.sub_category);
}

// ---------------------------------------------------------------- 場次

export function rowToSession(row) {
  if (!row) return null;
  return {
    id: row.id,
    activityId: row.activity_id,
    date: row.session_date,
    startTime: row.start_time || '',
    endTime: row.end_time || '',
    title: row.title || '',
    createdAt: row.created_at,
    attendanceCount: row.attendance_count === undefined
      ? undefined : Number(row.attendance_count),
  };
}

const SESSION_SELECT = `
  SELECT s.*, COALESCE(t.n, 0) AS attendance_count
  FROM sessions s
  LEFT JOIN (SELECT session_id, COUNT(*) AS n FROM attendances GROUP BY session_id) t
    ON t.session_id = s.id
`;

export async function sessionsOf(activityId) {
  const { rows } = await query(
    `${SESSION_SELECT} WHERE s.activity_id = $1 ORDER BY s.session_date, s.start_time`,
    [activityId],
  );
  return rows.map(rowToSession);
}

export async function findSession(id) {
  const { rows } = await query(`${SESSION_SELECT} WHERE s.id = $1`, [id]);
  return rowToSession(rows[0]);
}

export async function insertSessions(list) {
  if (!list.length) return 0;
  const values = [];
  const params = [];
  list.forEach((s, i) => {
    const b = i * 6;
    values.push(`($${b + 1},$${b + 2},$${b + 3}::date,$${b + 4},$${b + 5},$${b + 6})`);
    params.push(s.id, s.activityId, s.date, s.startTime, s.endTime, s.title);
  });
  // 同一活動、同一天同一時段視為重複，直接略過不要報錯
  const { rowCount } = await query(
    `INSERT INTO sessions (id, activity_id, session_date, start_time, end_time, title, created_at)
     SELECT v.id, v.activity_id, v.session_date, v.start_time, v.end_time, v.title, now()::text
     FROM (VALUES ${values.join(',')})
       AS v(id, activity_id, session_date, start_time, end_time, title)
     ON CONFLICT (activity_id, session_date, start_time) DO NOTHING`,
    params,
  );
  return rowCount;
}

/**
 * 改場次的時間或名稱。
 * 場次代號原封不動，掛在上面的簽到紀錄才不會被牽連。
 */
export async function updateSession(id, s) {
  const { rowCount } = await query(
    `UPDATE sessions SET session_date = $2::date, start_time = $3, end_time = $4, title = $5
     WHERE id = $1`,
    [id, s.date, s.startTime, s.endTime, s.title ?? ''],
  );
  return rowCount > 0;
}

export async function deleteSession(id) {
  const { rowCount } = await query('DELETE FROM sessions WHERE id = $1', [id]);
  return rowCount > 0;
}

export async function deleteSessionsOf(activityId) {
  await query('DELETE FROM sessions WHERE activity_id = $1', [activityId]);
}

/** 場次異動後，把活動的起訖日期同步成第一場與最後一場。 */
export async function syncActivityDates(activityId) {
  await query(
    `UPDATE activities a
     SET event_date = COALESCE(x.first_date, a.event_date), end_date = x.last_date
     FROM (SELECT MIN(session_date) AS first_date, MAX(session_date) AS last_date
           FROM sessions WHERE activity_id = $1) x
     WHERE a.id = $1`,
    [activityId],
  );
}

// ---------------------------------------------------------------- 簽到

/**
 * 一段期間內的所有場次，行事曆用。
 * 帶上活動本身的資訊，前台才不用為了一格日期再去查一次活動。
 */
export async function sessionsBetween(from, to) {
  const { rows } = await query(
    `SELECT s.*, a.slug, a.title AS activity_title, a.unlisted, a.closed,
            a.capacity, a.registration_deadline, a.end_date, a.event_date,
            COALESCE(r.n, 0) AS registration_count
     FROM sessions s
     JOIN activities a ON a.id = s.activity_id
     LEFT JOIN (
       SELECT activity_id, COUNT(*) FILTER (WHERE status <> 'waitlist') AS n
       FROM registrations GROUP BY activity_id
     ) r ON r.activity_id = a.id
     WHERE s.session_date BETWEEN $1::date AND $2::date
     ORDER BY s.session_date, s.start_time NULLS FIRST, a.title`,
    [from, to],
  );
  return rows.map((r) => ({
    ...rowToSession(r),
    slug: r.slug,
    activityTitle: r.activity_title,
    unlisted: r.unlisted === true,
    closed: r.closed === true,
    capacity: Number(r.capacity) || 0,
    registrationCount: Number(r.registration_count) || 0,
    registrationDeadline: r.registration_deadline || '',
    eventDate: r.event_date,
    endDate: r.end_date || r.event_date,
  }));
}

/** 今天（或指定日期）有場次的活動，簽到頁用這個列出可選課程。 */
export async function sessionsOnDate(date) {
  const { rows } = await query(
    `SELECT s.*, a.title AS activity_title, a.id AS act_id,
            COALESCE(t.n, 0) AS attendance_count
     FROM sessions s
     JOIN activities a ON a.id = s.activity_id
     LEFT JOIN (SELECT session_id, COUNT(*) AS n FROM attendances GROUP BY session_id) t
       ON t.session_id = s.id
     WHERE s.session_date = $1::date
     ORDER BY s.start_time, a.title`,
    [date],
  );
  return rows.map((r) => ({ ...rowToSession(r), activityTitle: r.activity_title }));
}

export async function hasAttended(sessionId, studentId, client = null) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(
    'SELECT 1 FROM attendances WHERE session_id = $1 AND student_id = $2 LIMIT 1',
    [sessionId, studentId],
  );
  return rows.length > 0;
}

export async function insertAttendance(a) {
  await query(
    `INSERT INTO attendances
       (id, session_id, student_id, checked_in_at, method, was_registered)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [a.id, a.sessionId, a.studentId, a.checkedInAt, a.method, a.wasRegistered],
  );
  return a;
}

export async function deleteAttendance(id) {
  const { rows } = await query(
    `DELETE FROM attendances t USING students s
     WHERE t.id = $1 AND s.id = t.student_id RETURNING s.name`,
    [id],
  );
  return rows.length ? { deleted: rows[0].name } : null;
}

/** 某一場的簽到名單。 */
export async function attendanceRows(sessionId) {
  const { rows } = await query(
    `SELECT t.*, s.name, s.id_number, s.birth_date, s.profile
     FROM attendances t JOIN students s ON s.id = t.student_id
     WHERE t.session_id = $1
     ORDER BY t.checked_in_at`,
    [sessionId],
  );
  return rows;
}

/** 某個活動的出席矩陣：報名者 × 各場次是否出席。 */
export async function attendanceMatrix(activityId) {
  const { rows } = await query(
    `SELECT t.session_id, t.student_id, t.checked_in_at, t.was_registered
     FROM attendances t
     JOIN sessions s ON s.id = t.session_id
     WHERE s.activity_id = $1`,
    [activityId],
  );
  return rows;
}

/** 出席過這個活動但沒報名的人（現場臨時參加）。 */
export async function walkInStudents(activityId) {
  const { rows } = await query(
    `SELECT DISTINCT s.id, s.name, s.id_number, s.birth_date, s.profile
     FROM attendances t
     JOIN sessions ss ON ss.id = t.session_id
     JOIN students s  ON s.id = t.student_id
     WHERE ss.activity_id = $1
       AND NOT EXISTS (
         SELECT 1 FROM registrations r
         WHERE r.activity_id = $1 AND r.student_id = s.id)`,
    [activityId],
  );
  return rows;
}

/** 各活動的場次數，列表要顯示「共幾堂」。 */
export async function sessionCounts() {
  const { rows } = await query(
    'SELECT activity_id, COUNT(*)::int AS n FROM sessions GROUP BY activity_id',
  );
  return new Map(rows.map((r) => [r.activity_id, r.n]));
}

/**
 * 每一堂課配上那一堂的簽到數，給「按月統計」用。
 *
 * 以場次為單位而不是以活動為單位 —— 跨月的連續性團體要能算出
 * 「這個月上了幾堂、簽到幾人次」，用活動的日期分月會整團算到第一個月。
 */
export async function sessionAttendanceRows() {
  const { rows } = await query(
    `SELECT to_char(s.session_date, 'YYYY-MM') AS month,
            s.activity_id, s.session_date, s.start_time, s.end_time, s.title,
            COALESCE(t.n, 0)::int AS attendance
     FROM sessions s
     LEFT JOIN (SELECT session_id, COUNT(*) AS n FROM attendances GROUP BY session_id) t
       ON t.session_id = s.id
     ORDER BY s.session_date, s.start_time`,
  );
  return rows;
}

/** 每個月的實際人數（同一個人來幾堂都只算一個）。 */
export async function attendancePeopleByMonth() {
  const { rows } = await query(
    `SELECT to_char(s.session_date, 'YYYY-MM') AS month,
            COUNT(DISTINCT t.student_id)::int AS people
     FROM attendances t JOIN sessions s ON s.id = t.session_id
     GROUP BY 1`,
  );
  return new Map(rows.map((r) => [r.month, r.people]));
}

// ---------------------------------------------------------------- 前後測

function rowToQuestion(row) {
  if (!row) return null;
  return {
    id: row.id,
    text: row.text,
    type: row.type,
    options: Array.isArray(row.options) ? row.options : [],
    category: row.category || '',
    archived: row.archived === true,
    sortOrder: Number(row.sort_order) || 0,
    createdAt: row.created_at,
    // 有 JOIN 統計時才有：這一題被幾個活動用過
    usedBy: row.used_by === undefined ? undefined : Number(row.used_by),
  };
}

/** 題庫全部題目（含停用的，後台自己過濾）。 */
export async function allQuestions() {
  const { rows } = await query(
    `SELECT q.*, COALESCE(u.n, 0) AS used_by
     FROM survey_questions q
     LEFT JOIN (SELECT question_id, COUNT(DISTINCT activity_id) AS n
                FROM activity_questions GROUP BY question_id) u
       ON u.question_id = q.id
     ORDER BY q.category, q.sort_order, q.created_at`,
  );
  return rows.map(rowToQuestion);
}

export async function findQuestion(id) {
  const { rows } = await query('SELECT * FROM survey_questions WHERE id = $1', [id]);
  return rowToQuestion(rows[0]);
}

export async function insertQuestion(q) {
  await query(
    `INSERT INTO survey_questions (id, text, type, options, category, archived, sort_order, created_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8)`,
    [q.id, q.text, q.type, JSON.stringify(q.options || []), q.category || '',
      q.archived === true, Number(q.sortOrder) || 0, q.createdAt],
  );
  return findQuestion(q.id);
}

export async function updateQuestionRow(id, q) {
  await query(
    `UPDATE survey_questions
     SET text = $2, type = $3, options = $4::jsonb, category = $5,
         archived = $6, sort_order = $7
     WHERE id = $1`,
    [id, q.text, q.type, JSON.stringify(q.options || []), q.category || '',
      q.archived === true, Number(q.sortOrder) || 0],
  );
  return findQuestion(id);
}

/** 有活動用過的題目不能刪，只能停用 —— 刪了舊活動的作答就對不回題目。 */
export async function questionUsage(id) {
  const { rows } = await query(
    'SELECT COUNT(DISTINCT activity_id)::int AS n FROM activity_questions WHERE question_id = $1',
    [id],
  );
  return Number(rows[0]?.n) || 0;
}

export async function deleteQuestionRow(id) {
  const { rowCount } = await query('DELETE FROM survey_questions WHERE id = $1', [id]);
  return rowCount > 0;
}

/** 這個活動挑了哪幾題（帶題目內容，照挑選的順序）。 */
export async function questionsOfActivity(activityId) {
  const { rows } = await query(
    `SELECT q.*, aq.phase, aq.sort_order AS pick_order
     FROM activity_questions aq
     JOIN survey_questions q ON q.id = aq.question_id
     WHERE aq.activity_id = $1
     ORDER BY aq.sort_order, q.created_at`,
    [activityId],
  );
  return rows.map((r) => ({ ...rowToQuestion(r), phase: r.phase, sortOrder: Number(r.pick_order) || 0 }));
}

/** 重設這個活動的挑題。傳進來的就是最終結果。 */
export async function replaceActivityQuestions(activityId, picks) {
  await query('DELETE FROM activity_questions WHERE activity_id = $1', [activityId]);
  if (!picks.length) return questionsOfActivity(activityId);
  const values = [];
  const params = [];
  picks.forEach((p, i) => {
    const b = i * 5;
    values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
    params.push(p.id, activityId, p.questionId, p.phase, p.sortOrder);
  });
  await query(
    `INSERT INTO activity_questions (id, activity_id, question_id, phase, sort_order)
     VALUES ${values.join(',')}`,
    params,
  );
  return questionsOfActivity(activityId);
}

/** 送出一份作答。同一個人同一份重填就是覆蓋。 */
export async function upsertResponse(r) {
  await query(
    `INSERT INTO survey_responses (id, activity_id, student_id, phase, answers, submitted_at)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6)
     ON CONFLICT (activity_id, student_id, phase)
     DO UPDATE SET answers = EXCLUDED.answers, submitted_at = EXCLUDED.submitted_at`,
    [r.id, r.activityId, r.studentId, r.phase, JSON.stringify(r.answers || {}), r.submittedAt],
  );
}

export async function findResponse(activityId, studentId, phase) {
  const { rows } = await query(
    'SELECT * FROM survey_responses WHERE activity_id = $1 AND student_id = $2 AND phase = $3',
    [activityId, studentId, phase],
  );
  const row = rows[0];
  return row ? { ...row, answers: row.answers || {}, submittedAt: row.submitted_at } : null;
}

/** 一個活動的所有作答，帶少年姓名。 */
export async function responsesOfActivity(activityId) {
  const { rows } = await query(
    `SELECT r.*, s.name
     FROM survey_responses r
     JOIN students s ON s.id = r.student_id
     WHERE r.activity_id = $1
     ORDER BY s.name, r.phase`,
    [activityId],
  );
  return rows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    name: r.name,
    phase: r.phase,
    answers: r.answers || {},
    submittedAt: r.submitted_at,
  }));
}

export async function deleteResponse(id) {
  const { rowCount } = await query('DELETE FROM survey_responses WHERE id = $1', [id]);
  return rowCount > 0;
}

// ---------------------------------------------------------------- 手動人次

function rowToManualCount(row) {
  if (!row) return null;
  return {
    id: row.id,
    month: row.month,
    title: row.title,
    headcount: Number(row.headcount) || 0,
    people: Number(row.people) || 0,
    sessions: Number(row.sessions) || 0,
    programCategory: row.program_category || '',
    serviceType: row.service_type || '',
    subCategory: row.sub_category || '',
    note: row.note || '',
    createdAt: row.created_at,
  };
}

/**
 * 手動人次。
 * 有給 filter 就照月份與分類篩，跟月報的篩選條件一致。
 */
export async function manualCounts(filter = {}) {
  const where = [];
  const params = [];
  const add = (sql, value) => {
    if (!value) return;
    params.push(value);
    where.push(sql.replace('$?', `$${params.length}`));
  };
  add('month = $?', filter.month);
  add('program_category = $?', filter.programCategory);
  add('service_type = $?', filter.serviceType);
  add('sub_category = $?', filter.subCategory);
  const { rows } = await query(
    `SELECT * FROM manual_counts
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY month DESC, created_at`,
    params,
  );
  return rows.map(rowToManualCount);
}

export async function findManualCount(id) {
  const { rows } = await query('SELECT * FROM manual_counts WHERE id = $1', [id]);
  return rowToManualCount(rows[0]);
}

export async function insertManualCount(c) {
  await query(
    `INSERT INTO manual_counts
       (id, month, title, headcount, people, sessions,
        program_category, service_type, sub_category, note, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [c.id, c.month, c.title, c.headcount, c.people, c.sessions,
      c.programCategory, c.serviceType, c.subCategory, c.note, c.createdAt],
  );
  return findManualCount(c.id);
}

export async function updateManualCountRow(id, c) {
  await query(
    `UPDATE manual_counts SET
       month = $2, title = $3, headcount = $4, people = $5, sessions = $6,
       program_category = $7, service_type = $8, sub_category = $9, note = $10
     WHERE id = $1`,
    [id, c.month, c.title, c.headcount, c.people, c.sessions,
      c.programCategory, c.serviceType, c.subCategory, c.note],
  );
  return findManualCount(id);
}

export async function deleteManualCountRow(id) {
  const { rowCount } = await query('DELETE FROM manual_counts WHERE id = $1', [id]);
  return rowCount > 0;
}

/** 手動人次用過的月份，月報的月份下拉要一起列出來。 */
export async function manualCountMonths() {
  const { rows } = await query('SELECT DISTINCT month FROM manual_counts ORDER BY month DESC');
  return rows.map((r) => r.month);
}
