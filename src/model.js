import { withLock } from './db.js';
import * as repo from './repo.js';
import {
  STUDENT_FIELDS, REGISTRATION_FIELDS, NTPC_DISTRICTS,
  PROGRAM_CATEGORIES, SERVICE_TYPES,
} from './fields.js';
import {
  newId, nowInTaipei, todayInTaipei, toRocDate, normalizeBirthDate, ageOn, ageBucket,
  normalizeIdNumber, isValidIdNumber, normalizePhone, toHalfWidth, slugify, toArray,
} from './util.js';

// ---------------------------------------------------------------- 錯誤

export function badRequest(message) {
  return Object.assign(new Error(message), { status: 400, expected: true });
}
export function notFound(message) {
  return Object.assign(new Error(message), { status: 404, expected: true });
}
export function conflict(message) {
  return Object.assign(new Error(message), { status: 409, expected: true });
}

// ---------------------------------------------------------------- 活動

/**
 * 活動是否已結束。
 *
 * 用「最後一場」的日期判斷，不是第一場 —— 連續性課程 7 月開課、8 月才結束，
 * 課還在上的時候不能被當成過往活動。單日活動的起訖日期相同，行為不變。
 * 活動當天仍算進行中，隔天起才自動歸到「過往活動」。
 */
export function isPast(activity) {
  const last = activity.endDate || activity.eventDate;
  if (!last) return false;
  return last < todayInTaipei();
}

/** 報名是否仍開放：沒被手動關閉、未過期、且未過報名截止日。 */
export function isOpenForRegistration(activity) {
  if (activity.closed) return false;
  if (isPast(activity)) return false;
  if (activity.registrationDeadline && activity.registrationDeadline < todayInTaipei()) return false;
  return true;
}

/** 幫活動加上前台/後台都會用到的計算欄位。 */
export function decorateActivity(activity) {
  const registrationCount = activity.registrationCount ?? 0;
  const capacity = Number(activity.capacity) || 0;
  return {
    ...activity,
    registrationCount,
    isPast: isPast(activity),
    isOpen: isOpenForRegistration(activity),
    isFull: capacity > 0 && registrationCount >= capacity,
    remainingSlots: capacity > 0 ? Math.max(0, capacity - registrationCount) : null,
  };
}

/** 依日期排序：即將舉行的由近到遠，過往活動由新到舊。 */
export async function listActivities(scope = 'all') {
  const counts = await repo.sessionCounts();
  const all = (await repo.allActivities())
    .map((a) => decorateActivity({ ...a, sessionCount: counts.get(a.id) || 1 }));
  const upcoming = all.filter((a) => !a.isPast)
    .sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate)));
  const past = all.filter((a) => a.isPast)
    .sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)));
  if (scope === 'upcoming') return upcoming;
  if (scope === 'past') return past;
  return [...upcoming, ...past];
}

export async function findActivity(idOrSlug) {
  const activity = await repo.findActivityRow(idOrSlug);
  return activity ? decorateActivity(activity) : null;
}

/** 產生不會撞名的網址代稱，每個活動都有自己的子頁面 /activity/<slug>。 */
async function uniqueSlug(title, eventDate, excludeId = null) {
  const base = slugify(title, eventDate);
  let candidate = base;
  let n = 2;
  while (await repo.slugExists(candidate, excludeId)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

const ACTIVITY_TEXT_FIELDS = [
  'title', 'summary', 'description', 'eventTime', 'location',
  'gatheringPlace', 'contact', 'eventDate', 'registrationDeadline',
  // 給工作人員做月報統計的分類，不會顯示在前台
  'programCategory', 'serviceType', 'subCategory',
];

function cleanActivityInput(input) {
  const out = {};
  for (const key of ACTIVITY_TEXT_FIELDS) {
    if (input[key] !== undefined) out[key] = String(input[key] ?? '').trim();
  }
  if (input.capacity !== undefined) {
    const n = Number(input.capacity);
    out.capacity = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  if (input.closed !== undefined) out.closed = Boolean(input.closed);
  return out;
}

/** 大分類與小分類只能填預設的選項（留白代表還沒分類）。 */
function validateCategories(data) {
  if (data.programCategory && !PROGRAM_CATEGORIES.includes(data.programCategory)) {
    throw badRequest('「方案分類」只能選清單裡的選項。');
  }
  if (data.serviceType && !SERVICE_TYPES.includes(data.serviceType)) {
    throw badRequest('「服務類型」只能選清單裡的選項。');
  }
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function createActivity(input) {
  const data = cleanActivityInput(input);
  if (!data.title) throw badRequest('請填寫活動名稱。');
  if (!data.eventDate) throw badRequest('請填寫活動日期。');
  if (!DATE_RE.test(data.eventDate)) throw badRequest('活動日期格式不正確。');
  if (data.registrationDeadline && !DATE_RE.test(data.registrationDeadline)) {
    throw badRequest('報名截止日格式不正確。');
  }
  validateCategories(data);

  const activity = {
    id: newId(),
    slug: await uniqueSlug(input.slug || data.title, data.eventDate),
    title: data.title,
    summary: data.summary || '',
    description: data.description || '',
    eventDate: data.eventDate,
    eventTime: data.eventTime || '',
    location: data.location || '',
    gatheringPlace: data.gatheringPlace || '',
    capacity: data.capacity ?? 0,
    registrationDeadline: data.registrationDeadline || '',
    contact: data.contact || '',
    closed: data.closed ?? false,
    programCategory: data.programCategory || '',
    serviceType: data.serviceType || '',
    subCategory: data.subCategory || '',
    createdAt: nowInTaipei(),
  };
  const created = await repo.insertActivity(activity);

  // 每個活動至少要有一個場次；連續性課程一次把整個系列排好
  const dates = input.seriesEnd
    ? generateSessionDates(activity.eventDate, String(input.seriesEnd).trim(),
      Array.isArray(input.weekdays) ? input.weekdays : String(input.weekdays || '').split(',').filter(Boolean))
    : [activity.eventDate];

  const [startTime, endTime] = splitTimeRange(activity.eventTime);
  await repo.insertSessions(dates.map((date) => ({
    id: newId(), activityId: activity.id, date, startTime, endTime, title: '',
  })));
  await repo.syncActivityDates(activity.id);

  return decorateActivity(await repo.findActivityRow(created.id));
}

/** 「08:00-19:00」拆成開始與結束時間，拆不出來就當成沒填。 */
function splitTimeRange(text) {
  const m = /^\s*(\d{1,2}:\d{2})\s*[-~—－至]\s*(\d{1,2}:\d{2})\s*$/.exec(String(text || ''));
  return m ? [m[1], m[2]] : ['', ''];
}

export async function updateActivity(id, input) {
  const existing = await repo.findActivityRow(id);
  if (!existing) throw notFound('找不到這個活動。');

  const data = cleanActivityInput(input);
  if (data.title === '') throw badRequest('活動名稱不能空白。');
  if (data.eventDate !== undefined && !DATE_RE.test(data.eventDate)) {
    throw badRequest('活動日期格式不正確。');
  }
  if (data.registrationDeadline && !DATE_RE.test(data.registrationDeadline)) {
    throw badRequest('報名截止日格式不正確。');
  }
  validateCategories(data);

  const merged = { ...existing, ...data };
  // 網址代稱建立後就固定不動，避免已經分享出去的報名連結失效。
  // 真的要改，才用 input.slug 明確指定。
  if (input.slug && input.slug !== existing.slug) {
    merged.slug = await uniqueSlug(input.slug, merged.eventDate, existing.id);
  }
  return decorateActivity(await repo.updateActivityRow(existing.id, merged));
}

/** 刪除活動，連同該活動的報名紀錄一起移除（學生基本資料保留）。 */
export async function deleteActivity(id) {
  const activity = await repo.findActivityRow(id);
  if (!activity) throw notFound('找不到這個活動。');
  const result = await repo.deleteActivityRow(activity.id);
  if (!result) throw notFound('找不到這個活動。');
  return result;
}

// ---------------------------------------------------------------- 學生

const STUDENT_KEYS = STUDENT_FIELDS.map((f) => f.key);
const TRANSFORMS = Object.fromEntries(STUDENT_FIELDS.map((f) => [f.key, f.transform]));

/** 逐欄正規化學生資料，讓比對與匯出的格式一致。 */
export function normalizeStudentInput(input = {}) {
  const out = {};
  for (const key of STUDENT_KEYS) {
    let value = input[key];
    if (Array.isArray(value)) {
      out[key] = toArray(value).map((v) => String(v).trim());
      continue;
    }
    value = String(value ?? '').trim();
    if (TRANSFORMS[key] === 'idNumber') value = normalizeIdNumber(value);
    else if (TRANSFORMS[key] === 'phone') value = normalizePhone(value);
    // 這些都是單行欄位，把換行與連續空白收成一個空白，
    // 匯出的 CSV 跟名單表格才不會被貼上來的地址撐開。
    else value = toHalfWidth(value).replace(/\s+/g, ' ').trim();
    out[key] = value;
  }
  out.birthDate = normalizeBirthDate(out.birthDate);
  out.guardianBirthDate = normalizeBirthDate(out.guardianBirthDate);
  out.familyStatus = toArray(input.familyStatus);
  return out;
}

/** 檢查必填與格式，回傳錯誤訊息陣列（空陣列代表通過）。 */
export function validateStudent(data) {
  const errors = [];
  for (const field of STUDENT_FIELDS) {
    const value = data[field.key];
    const empty = Array.isArray(value) ? value.length === 0 : !String(value ?? '').trim();
    if (field.required && empty) errors.push(`「${field.label}」為必填。`);
  }
  if (data.idNumber && !isValidIdNumber(data.idNumber)) {
    errors.push('「身份證字號」格式不正確（例：A123456789）。');
  }
  if (data.guardianIdNumber && !isValidIdNumber(data.guardianIdNumber)) {
    errors.push('「監護人身分證號」格式不正確（例：A123456789）。');
  }
  if (data.birthDate && !DATE_RE.test(data.birthDate)) {
    errors.push('「出生年月日」格式不正確。');
  }
  if (data.guardianBirthDate && !DATE_RE.test(data.guardianBirthDate)) {
    errors.push('「監護人出生年月日」格式不正確。');
  }
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    errors.push('「Email」格式不正確。');
  }
  if (data.district && !NTPC_DISTRICTS.includes(data.district)) {
    errors.push('「學籍/居住區域」只能選新北市的行政區。');
  }
  return errors;
}

/** 幫學生資料補上計算欄位。 */
export function decorateStudent(student) {
  return {
    ...student,
    birthDateRoc: toRocDate(student.birthDate),
    guardianBirthDateRoc: toRocDate(student.guardianBirthDate),
    age: ageOn(student.birthDate),
    registrationCount: student.registrationCount ?? 0,
    lastRegisteredAt: student.lastRegisteredAt ?? '',
  };
}

export async function findStudentById(id) {
  const student = await repo.findStudentById(id);
  return student ? decorateStudent(student) : null;
}

/**
 * 老朋友快速報名的查詢：姓名 + 身分證字號 + 出生年月日 三項全對才回傳資料。
 * 只對一兩項不會透露任何資訊。
 */
export async function lookupStudent({ name, idNumber, birthDate }) {
  const id = normalizeIdNumber(idNumber);
  const birth = normalizeBirthDate(birthDate);
  const cleanName = toHalfWidth(String(name || '')).replace(/\s+/g, ' ').trim();
  if (!id || !birth || !cleanName) return null;
  const student = await repo.lookupStudentRow(cleanName, id, birth);
  return student ? decorateStudent(student) : null;
}

export async function updateStudent(id, input) {
  const student = await repo.findStudentById(id);
  if (!student) throw notFound('找不到這位學生。');

  const merged = normalizeStudentInput({ ...student, ...input });
  const errors = validateStudent(merged);
  if (errors.length) throw badRequest(errors.join('\n'));

  const clash = await repo.findStudentByIdNumber(merged.idNumber);
  if (clash && clash.id !== student.id) {
    throw badRequest('這個身分證字號已經被其他學生使用了。');
  }
  return decorateStudent(await repo.updateStudentRow(student.id, merged, nowInTaipei()));
}

/** 刪除學生，連同他所有的報名紀錄。 */
export async function deleteStudent(id) {
  const result = await repo.deleteStudentRow(id);
  if (!result) throw notFound('找不到這位學生。');
  return result;
}

/** 學生總表搜尋：姓名、身分證、學校、區域、電話、LINE ID、Email、監護人都吃得到。 */
export async function searchStudents(query = '') {
  const q = toHalfWidth(String(query)).trim();
  const students = await repo.searchStudentRows(q);
  return students.map(decorateStudent);
}

// ---------------------------------------------------------------- 報名

/** 長文字題最多存這麼多字，避免有人貼一整篇進來。 */
const MAX_TEXTAREA_LENGTH = 1000;

function normalizeAnswers(input = {}) {
  const answers = {};
  for (const field of REGISTRATION_FIELDS) {
    const raw = input[field.key];
    if (field.type === 'checkbox') {
      answers[field.key] = toArray(raw);
    } else if (field.type === 'textarea') {
      // 這種題目請少年「多說一點」，分段寫的換行要留著，
      // 只把連續空行收斂並限制長度。
      answers[field.key] = toHalfWidth(String(raw ?? ''))
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim()
        .slice(0, MAX_TEXTAREA_LENGTH);
    } else {
      answers[field.key] = toHalfWidth(String(raw ?? '')).replace(/\s+/g, ' ').trim();
    }
  }
  return answers;
}

function validateAnswers(answers) {
  const errors = [];
  for (const field of REGISTRATION_FIELDS) {
    const value = answers[field.key];
    if (field.type === 'checkbox') {
      const min = field.minChoices || (field.required ? 1 : 0);
      if (value.length < min) {
        errors.push(min > 1
          ? `「${field.label}」請至少選 ${min} 項。`
          : `「${field.label}」為必填。`);
      }
    } else if (field.required && !value) {
      errors.push(`「${field.label}」為必填。`);
    }
  }
  return errors;
}

/**
 * 送出報名。
 *
 * - 第一次報名：帶完整 profile，建立學生主檔後報名。
 * - 老朋友報名：帶 studentId（由 lookupStudent 取得），profile 可省略；
 *   若有帶 profile 就順便更新主檔（例如換學校、升年級、換手機）。
 *
 * 整段包在活動層級的鎖裡，兩個人同時按送出也不會超收名額。
 */
export async function register({ activity, profile, studentId, answers: rawAnswers }) {
  if (!isOpenForRegistration(activity)) {
    throw badRequest('這個活動目前沒有開放報名。');
  }

  const answers = normalizeAnswers(rawAnswers);
  const answerErrors = validateAnswers(answers);
  if (answerErrors.length) throw badRequest(answerErrors.join('\n'));

  return withLock(`activity:${activity.id}`, async (client) => {
    let student = studentId ? await repo.findStudentById(studentId, client) : null;

    if (profile && Object.keys(profile).length) {
      const data = normalizeStudentInput(student ? { ...student, ...profile } : profile);
      const errors = validateStudent(data);
      if (errors.length) throw badRequest(errors.join('\n'));

      const clash = await repo.findStudentByIdNumber(data.idNumber, client);
      if (student && clash && clash.id !== student.id) {
        throw badRequest('這個身分證字號已經被其他學生使用了。');
      }
      student = await repo.upsertStudentRow(
        clash ? clash.id : (student?.id ?? newId()), data, nowInTaipei(), client,
      );
    }
    if (!student) throw badRequest('查不到報名者資料，請改用完整報名表。');

    if (await repo.hasRegistered(activity.id, student.id, client)) {
      throw conflict('你已經報名過這個活動了，不用重複報名。');
    }
    const capacity = Number(activity.capacity) || 0;
    if (capacity > 0 && await repo.countRegistrations(activity.id, client) >= capacity) {
      throw conflict('這個活動已經額滿了。');
    }

    const registration = {
      id: newId(),
      activityId: activity.id,
      studentId: student.id,
      answers,
      // 保留報名當下的年齡，之後學生長大了，歷史名冊上的年齡仍是正確的。
      ageAtEvent: ageBucket(ageOn(student.birthDate, activity.eventDate)),
      note: '',
      registeredAt: nowInTaipei(),
    };
    await repo.insertRegistration(registration, client);
    return { registration, student: decorateStudent(student) };
  });
}

/** 取消/刪除某一筆報名（學生主檔會保留）。 */
export async function deleteRegistration(id) {
  const result = await repo.deleteRegistrationRow(id);
  if (!result) throw notFound('找不到這筆報名紀錄。');
  return result;
}

export async function setRegistrationNote(id, note) {
  const ok = await repo.setRegistrationNoteRow(id, String(note ?? '').trim());
  if (!ok) throw notFound('找不到這筆報名紀錄。');
  return { ok: true };
}

/** 把報名紀錄攤平成名冊/匯出用的一列資料。 */
export async function buildRoster(activity) {
  const rows = await repo.rosterRows(activity.id);
  return rows.map((row, index) => {
    const student = decorateStudent({
      id: row.student_id,
      ...row.profile,
      idNumber: row.id_number,
      name: row.name,
      birthDate: row.birth_date,
      createdAt: row.student_created_at,
    });
    return {
      seq: index + 1,
      registrationId: row.id,
      studentId: row.student_id,
      registeredAt: row.registered_at,
      activityTitle: activity.title,
      ageAtEvent: row.age_at_event,
      note: row.note || '',
      ...student,
      ...row.answers,
    };
  });
}

/** 某位學生報名過哪些活動，後台點名字時會展開。 */
export async function studentHistory(studentId) {
  const rows = await repo.studentHistoryRows(studentId);
  return rows.map((row) => ({
    activityId: row.activity_id,
    activitySlug: row.slug,
    activityTitle: row.title,
    eventDate: row.event_date,
    isPast: isPast({ eventDate: row.event_date }),
    registrationId: row.registration_id,
    registeredAt: row.registered_at,
  }));
}

export async function stats() {
  const [row, activities] = await Promise.all([repo.statsRow(), repo.allActivities()]);
  return {
    activityCount: Number(row.activities),
    upcomingCount: activities.filter((a) => !isPast(a)).length,
    pastCount: activities.filter((a) => isPast(a)).length,
    studentCount: Number(row.students),
    registrationCount: Number(row.registrations),
  };
}

export const hasRegistered = repo.hasRegistered;

// ---------------------------------------------------------------- 月報統計

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/** 年齡的排序：11歲以下 → 12 → 13 … → 19歲以上，方便貼進政府的表格。 */
function ageOrder(key) {
  if (key === '11歲以下') return -1;
  if (key === '19歲以上') return 99;
  const n = Number(key);
  return Number.isFinite(n) ? n : 1000;
}

/**
 * 產出某個月份的統計：居住地區、年齡、身分別各自的人次。
 *
 * basis 決定「這個月」怎麼算：
 *   event（預設）—— 依活動舉辦的月份，也就是「本月辦了哪些活動、服務多少人次」
 *   registration —— 依報名送出的月份
 *
 * 可以再用活動分類（大分類／小分類／細分類）篩選。
 */
export async function monthlyReport(input = {}) {
  const month = String(input.month || '').trim();
  if (month && !MONTH_RE.test(month)) throw badRequest('月份格式不正確（例：2026-08）。');

  // 預設看實際出席：政府月報要的是服務量，不是報名數
  const basis = ['registration', 'event'].includes(input.basis) ? input.basis : 'attendance';
  const filter = {
    month,
    basis,
    programCategory: String(input.programCategory || '').trim(),
    serviceType: String(input.serviceType || '').trim(),
    subCategory: String(input.subCategory || '').trim(),
  };

  const [stats, months, subCategories] = await Promise.all([
    repo.reportStats(filter),
    repo.reportMonths(basis),
    repo.usedSubCategories(),
  ]);

  // 地區依新北市的既定順序排，年齡由小到大，這樣每個月的報表長得一樣
  const districtOrder = new Map(NTPC_DISTRICTS.map((d, i) => [d, i]));
  stats.byDistrict.sort((a, b) => (districtOrder.get(a.key) ?? 999) - (districtOrder.get(b.key) ?? 999));
  stats.byAge.sort((a, b) => ageOrder(a.key) - ageOrder(b.key));

  return {
    month,
    basis,
    filter,
    months,
    subCategories,
    programCategories: PROGRAM_CATEGORIES,
    serviceTypes: SERVICE_TYPES,
    totals: {
      // 出席基準時這個數字是「出席人次」，報名基準時是「報名人次」
      registrations: Number(stats.totals.registrations) || 0,
      people: Number(stats.totals.people) || 0,
      activities: Number(stats.totals.activities) || 0,
      sessions: Number(stats.totals.sessions) || 0,
    },
    byDistrict: stats.byDistrict,
    byAge: stats.byAge,
    byIdentity: stats.byIdentity,
    activities: stats.activities.map((a) => ({
      id: a.id,
      title: a.title,
      eventDate: a.event_date,
      endDate: a.end_date || a.event_date,
      programCategory: a.program_category || '',
      serviceType: a.service_type || '',
      subCategory: a.sub_category || '',
      registrationCount: Number(a.n) || 0,
    })),
  };
}

// ---------------------------------------------------------------- 場次

const TIME_RE = /^([01]?\d|2[0-3]):[0-5]\d$/;

/** 把日期字串加上天數，回傳 YYYY-MM-DD。 */
function addDays(iso, days) {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 星期幾（0=日 … 6=六）。 */
function weekdayOf(iso) {
  return new Date(`${iso}T00:00:00Z`).getUTCDay();
}

/**
 * 產生連續性課程的場次。
 * 例：水電課 7/1 到 8/31 的每週三 → 產出 9 個場次。
 *
 * weekdays 是 0-6 的陣列（0 是星期日）；留空代表期間內每一天都上課。
 */
export function generateSessionDates(startDate, endDate, weekdays = []) {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw badRequest('請填寫正確的起訖日期。');
  }
  if (endDate < startDate) throw badRequest('結束日期不能早於開始日期。');

  const wanted = new Set(weekdays.map(Number).filter((n) => n >= 0 && n <= 6));
  const dates = [];
  for (let d = startDate; d <= endDate; d = addDays(d, 1)) {
    if (!wanted.size || wanted.has(weekdayOf(d))) dates.push(d);
    // 兩年份的每日課程已經是極限，避免有人填錯日期灌爆資料庫
    if (dates.length > 400) throw badRequest('場次太多了（超過 400 場），請確認日期是否填錯。');
  }
  if (!dates.length) throw badRequest('這段期間內沒有符合的日期，請確認星期選對了。');
  return dates;
}

export async function listSessions(activityId) {
  return repo.sessionsOf(activityId);
}

/**
 * 重新設定某個活動的所有場次。
 * 傳進來的清單就是最終結果，沒列到的場次會被刪掉。
 */
export async function replaceSessions(activityId, list) {
  const activity = await repo.findActivityRow(activityId);
  if (!activity) throw notFound('找不到這個活動。');

  const rows = [];
  for (const item of list) {
    const date = String(item.date || '').trim();
    if (!DATE_RE.test(date)) throw badRequest(`場次日期格式不正確：${date || '(空白)'}`);
    const startTime = String(item.startTime || '').trim();
    const endTime = String(item.endTime || '').trim();
    if (startTime && !TIME_RE.test(startTime)) throw badRequest(`開始時間格式不正確：${startTime}`);
    if (endTime && !TIME_RE.test(endTime)) throw badRequest(`結束時間格式不正確：${endTime}`);
    rows.push({
      id: newId(),
      activityId,
      date,
      startTime,
      endTime,
      title: String(item.title || '').trim(),
    });
  }
  if (!rows.length) throw badRequest('活動至少要有一個場次。');

  await repo.deleteSessionsOf(activityId);
  await repo.insertSessions(rows);
  await repo.syncActivityDates(activityId);
  return repo.sessionsOf(activityId);
}

/** 在既有場次之外再加幾場（不會動到原本的）。 */
export async function addSessions(activityId, list) {
  const existing = await repo.sessionsOf(activityId);
  return replaceSessions(activityId, [
    ...existing.map((s) => ({
      date: s.date, startTime: s.startTime, endTime: s.endTime, title: s.title,
    })),
    ...list,
  ]);
}

export async function removeSession(sessionId) {
  const session = await repo.findSession(sessionId);
  if (!session) throw notFound('找不到這個場次。');
  const remaining = await repo.sessionsOf(session.activityId);
  if (remaining.length <= 1) throw badRequest('活動至少要保留一個場次。');
  await repo.deleteSession(sessionId);
  await repo.syncActivityDates(session.activityId);
  return { deleted: session.date };
}

/** 幫活動補上場次摘要，前台與後台都會用到。 */
export function summariseSessions(sessions) {
  if (!sessions.length) return { count: 0, label: '' };
  const dates = sessions.map((s) => s.date).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (sessions.length === 1) return { count: 1, first, last, label: '' };

  // 全部都在同一個星期幾的話，講「每週三」比列出九個日期好懂
  const weekdayNames = ['日', '一', '二', '三', '四', '五', '六'];
  const weekdays = [...new Set(dates.map(weekdayOf))];
  const weekly = weekdays.length === 1 ? `每週${weekdayNames[weekdays[0]]}` : '';
  return {
    count: sessions.length,
    first,
    last,
    label: `共 ${sessions.length} 堂${weekly ? `，${weekly}` : ''}`,
  };
}

// ---------------------------------------------------------------- 簽到

/** 今天有課的場次，簽到頁用這個列出可以選的課程。 */
export async function sessionsForCheckin(date) {
  const day = DATE_RE.test(String(date || '')) ? date : todayInTaipei();
  const sessions = await repo.sessionsOnDate(day);
  return { date: day, sessions };
}

/**
 * 找出「這個名字是哪一位少年」。
 *
 * 簽到現場只問姓名，所以同名的處理要想清楚：
 *   1. 沒人叫這個名字 → 直接告訴他查不到。
 *   2. 只有一位 → 就是他，不用再問。
 *   3. 好幾位同名 → 先看誰報名了這個活動，多半就分出來了。
 *   4. 還是分不出來 → 才多問一次出生年月日（後台代簽也可以用身分證字號）。
 *
 * 第 4 種情況很少見，不必為了它讓所有人都多填一個欄位。
 */
async function resolveStudentForCheckin({ activityId, name, birthDate, idNumber }) {
  let candidates = await repo.findStudentsByName(name);
  if (!candidates.length) {
    throw badRequest(
      `查不到「${name}」的資料。請確認姓名有沒有打錯，`
      + '或是你還沒報名過培力園的活動（第一次來請先完成報名，或找現場社工幫忙）。',
    );
  }
  if (candidates.length === 1) return { student: candidates[0] };

  const registered = [];
  for (const s of candidates) {
    if (await repo.hasRegistered(activityId, s.id)) registered.push(s);
  }
  if (registered.length === 1) return { student: registered[0] };
  if (registered.length > 1) candidates = registered;

  const wantedId = normalizeIdNumber(idNumber);
  if (wantedId) candidates = candidates.filter((s) => s.idNumber === wantedId);

  const birth = normalizeBirthDate(birthDate);
  if (birth) candidates = candidates.filter((s) => s.birthDate === birth);

  if (candidates.length === 1) return { student: candidates[0] };
  if (!birth && !wantedId) {
    return {
      needsBirthDate: true,
      message: `有 ${candidates.length} 位少年都叫「${name}」，`
        + '請再填一次出生年月日，確認是哪一位。',
    };
  }
  throw badRequest('姓名與出生年月日對不起來，請再確認一次，或找現場社工協助。');
}

/**
 * 簽到。
 *
 * 現場只問兩件事：參加哪一堂課、你叫什麼名字。少年一手拿手機一手排隊，
 * 欄位愈少愈好，所以不再要求身分證字號。
 *
 * 沒報名的人也能簽到 —— 現場常有臨時來的少年，這些人要算進出席人次，
 * 但會標記成「未報名」讓工作人員知道。
 */
export async function checkIn({ sessionId, name, birthDate, idNumber, method = 'qr' }) {
  const session = await repo.findSession(sessionId);
  if (!session) throw notFound('找不到這個場次，請確認選的課程正確。');

  const cleanName = toHalfWidth(String(name || '')).replace(/\s+/g, ' ').trim();
  if (!cleanName) throw badRequest('請輸入你的姓名。');

  const resolved = await resolveStudentForCheckin({
    activityId: session.activityId, name: cleanName, birthDate, idNumber,
  });
  // 同名太多、需要再問生日時先原路返回，前台會多顯示一個欄位
  if (resolved.needsBirthDate) return resolved;
  const { student } = resolved;

  if (await repo.hasAttended(session.id, student.id)) {
    throw conflict(`${student.name} 這一堂已經簽到過了。`);
  }

  const wasRegistered = await repo.hasRegistered(session.activityId, student.id);
  const activity = await repo.findActivityRow(session.activityId);

  await repo.insertAttendance({
    id: newId(),
    sessionId: session.id,
    studentId: student.id,
    checkedInAt: nowInTaipei(),
    method,
    wasRegistered,
  });

  return {
    studentName: student.name,
    activityTitle: activity ? activity.title : '',
    sessionDate: session.date,
    sessionTitle: session.title,
    wasRegistered,
  };
}

export async function removeAttendance(id) {
  const result = await repo.deleteAttendance(id);
  if (!result) throw notFound('找不到這筆簽到紀錄。');
  return result;
}

/** 某一場的簽到名單。 */
export async function sessionAttendance(sessionId) {
  const session = await repo.findSession(sessionId);
  if (!session) throw notFound('找不到這個場次。');
  const activity = await repo.findActivityRow(session.activityId);
  const rows = await repo.attendanceRows(sessionId);
  return {
    session,
    activity: activity ? decorateActivity(activity) : null,
    attendees: rows.map((r) => ({
      attendanceId: r.id,
      studentId: r.student_id,
      name: r.name,
      idNumber: r.id_number,
      district: r.profile?.district || '',
      school: r.profile?.school || '',
      mobile: r.profile?.mobile || '',
      checkedInAt: r.checked_in_at,
      method: r.method,
      wasRegistered: r.was_registered,
    })),
  };
}

/**
 * 出席總覽：報名者 × 各場次的出席狀況，加上臨時來的人。
 * 工作人員一眼看出誰缺席、誰全勤。
 */
export async function attendanceOverview(activityId) {
  const activity = await repo.findActivityRow(activityId);
  if (!activity) throw notFound('找不到這個活動。');

  const [sessions, roster, marks, walkIns] = await Promise.all([
    repo.sessionsOf(activityId),
    buildRoster(decorateActivity(activity)),
    repo.attendanceMatrix(activityId),
    repo.walkInStudents(activityId),
  ]);

  const attended = new Map();
  for (const m of marks) {
    if (!attended.has(m.student_id)) attended.set(m.student_id, new Set());
    attended.get(m.student_id).add(m.session_id);
  }

  const toRow = (studentId, name, extra) => {
    const mine = attended.get(studentId) || new Set();
    return {
      studentId,
      name,
      ...extra,
      attended: sessions.map((s) => mine.has(s.id)),
      attendedCount: sessions.filter((s) => mine.has(s.id)).length,
    };
  };

  return {
    activity: decorateActivity(activity),
    sessions,
    rows: [
      ...roster.map((r) => toRow(r.studentId, r.name, {
        idNumber: r.idNumber, district: r.district, school: r.school, registered: true,
      })),
      ...walkIns.map((w) => toRow(w.id, w.name, {
        idNumber: w.id_number,
        district: w.profile?.district || '',
        school: w.profile?.school || '',
        registered: false,
      })),
    ],
  };
}
