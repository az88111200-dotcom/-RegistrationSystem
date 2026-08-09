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
 * 活動是否已結束。以活動日期為準：活動當天仍算「即將舉行」，
 * 隔天起自動歸到「過往活動」，工作人員不必手動搬。
 */
export function isPast(activity) {
  if (!activity.eventDate) return false;
  return activity.eventDate < todayInTaipei();
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
  const all = (await repo.allActivities()).map(decorateActivity);
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
  return decorateActivity(await repo.insertActivity(activity));
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

  const basis = input.basis === 'registration' ? 'registration' : 'event';
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
      registrations: Number(stats.totals.registrations) || 0,
      people: Number(stats.totals.people) || 0,
      activities: Number(stats.totals.activities) || 0,
    },
    byDistrict: stats.byDistrict,
    byAge: stats.byAge,
    byIdentity: stats.byIdentity,
    activities: stats.activities.map((a) => ({
      id: a.id,
      title: a.title,
      eventDate: a.event_date,
      programCategory: a.program_category || '',
      serviceType: a.service_type || '',
      subCategory: a.sub_category || '',
      registrationCount: Number(a.n) || 0,
    })),
  };
}
