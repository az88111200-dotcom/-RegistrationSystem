import { getDb, mutate, backupDaily } from './store.js';
import { STUDENT_FIELDS, REGISTRATION_FIELDS, NTPC_DISTRICTS } from './fields.js';
import {
  newId, nowInTaipei, todayInTaipei, toRocDate, normalizeBirthDate, ageOn, ageBucket,
  normalizeIdNumber, isValidIdNumber, normalizePhone, toHalfWidth, slugify, toArray,
} from './util.js';

// ---------------------------------------------------------------- 活動

/**
 * 活動是否已結束。以活動日期為準：活動當天仍算「即將舉行」，
 * 隔天起自動歸到「過往活動」，工作人員不必手動搬。
 */
export function isPast(activity) {
  if (!activity.eventDate) return false;
  return activity.eventDate < todayInTaipei();
}

/** 報名是否仍開放：活動沒被手動關閉、未過期、且未過報名截止日。 */
export function isOpenForRegistration(activity) {
  if (activity.closed) return false;
  if (isPast(activity)) return false;
  if (activity.registrationDeadline && activity.registrationDeadline < todayInTaipei()) return false;
  return true;
}

export function countRegistrations(activityId) {
  return getDb().registrations.filter((r) => r.activityId === activityId).length;
}

/** 幫活動加上前台/後台都會用到的計算欄位。 */
export function decorateActivity(activity) {
  const registrationCount = countRegistrations(activity.id);
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
export function listActivities(scope = 'all') {
  const all = getDb().activities.map(decorateActivity);
  const upcoming = all.filter((a) => !a.isPast)
    .sort((a, b) => String(a.eventDate).localeCompare(String(b.eventDate)));
  const past = all.filter((a) => a.isPast)
    .sort((a, b) => String(b.eventDate).localeCompare(String(a.eventDate)));
  if (scope === 'upcoming') return upcoming;
  if (scope === 'past') return past;
  return [...upcoming, ...past];
}

export function findActivity(idOrSlug) {
  const db = getDb();
  return db.activities.find((a) => a.id === idOrSlug || a.slug === idOrSlug) || null;
}

/** 產生不會撞名的網址代稱，每個活動都有自己的子頁面 /activity/<slug>。 */
function uniqueSlug(title, eventDate, excludeId = null) {
  const db = getDb();
  const base = slugify(title, eventDate);
  let candidate = base;
  let n = 2;
  while (db.activities.some((a) => a.slug === candidate && a.id !== excludeId)) {
    candidate = `${base}-${n}`;
    n += 1;
  }
  return candidate;
}

const ACTIVITY_TEXT_FIELDS = [
  'title', 'summary', 'description', 'eventTime', 'location',
  'gatheringPlace', 'contact', 'eventDate', 'registrationDeadline',
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

export function createActivity(input) {
  const data = cleanActivityInput(input);
  if (!data.title) throw badRequest('請填寫活動名稱。');
  if (!data.eventDate) throw badRequest('請填寫活動日期。');
  const activity = {
    id: newId(),
    slug: uniqueSlug(input.slug || data.title, data.eventDate),
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
    createdAt: nowInTaipei(),
  };
  mutate((db) => db.activities.push(activity));
  return decorateActivity(activity);
}

export function updateActivity(id, input) {
  const activity = findActivity(id);
  if (!activity) throw notFound('找不到這個活動。');
  const data = cleanActivityInput(input);
  if (data.title === '') throw badRequest('活動名稱不能空白。');
  // 網址代稱建立後就固定不動，避免已經分享出去的報名連結失效。
  // 真的要改，才用 input.slug 明確指定。
  if (input.slug && input.slug !== activity.slug) {
    activity.slug = uniqueSlug(input.slug, data.eventDate || activity.eventDate, activity.id);
  }
  Object.assign(activity, data);
  mutate(() => {});
  return decorateActivity(activity);
}

/** 刪除活動，連同該活動的報名紀錄一起移除（學生基本資料保留）。 */
export function deleteActivity(id) {
  const activity = findActivity(id);
  if (!activity) throw notFound('找不到這個活動。');
  let removed = 0;
  mutate((db) => {
    db.activities = db.activities.filter((a) => a.id !== activity.id);
    const before = db.registrations.length;
    db.registrations = db.registrations.filter((r) => r.activityId !== activity.id);
    removed = before - db.registrations.length;
  });
  return { deleted: activity.title, removedRegistrations: removed };
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
  if (data.birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.birthDate)) {
    errors.push('「出生年月日」格式不正確。');
  }
  if (data.guardianBirthDate && !/^\d{4}-\d{2}-\d{2}$/.test(data.guardianBirthDate)) {
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

export function findStudentById(id) {
  return getDb().students.find((s) => s.id === id) || null;
}

/** 身分證字號是學生的唯一識別，用它判斷是不是同一個人。 */
export function findStudentByIdNumber(idNumber) {
  const key = normalizeIdNumber(idNumber);
  if (!key) return null;
  return getDb().students.find((s) => normalizeIdNumber(s.idNumber) === key) || null;
}

/**
 * 老朋友快速報名的查詢：姓名 + 身分證字號 + 出生年月日 三項全對才回傳資料。
 * 只對一兩項不會透露任何資訊。
 */
export function lookupStudent({ name, idNumber, birthDate }) {
  const student = findStudentByIdNumber(idNumber);
  if (!student) return null;
  const nameMatch = String(student.name).trim() === toHalfWidth(String(name || '')).trim();
  const birthMatch = student.birthDate === normalizeBirthDate(birthDate);
  return nameMatch && birthMatch ? student : null;
}

/** 幫學生資料補上計算欄位。 */
export function decorateStudent(student) {
  const regs = getDb().registrations.filter((r) => r.studentId === student.id);
  const last = regs.map((r) => r.registeredAt).sort().pop() || '';
  return {
    ...student,
    birthDateRoc: toRocDate(student.birthDate),
    guardianBirthDateRoc: toRocDate(student.guardianBirthDate),
    age: ageOn(student.birthDate),
    registrationCount: regs.length,
    lastRegisteredAt: last,
  };
}

/** 新建或更新學生主檔（以身分證字號為準）。 */
export function upsertStudent(data) {
  const existing = findStudentByIdNumber(data.idNumber);
  if (existing) {
    mutate(() => {
      Object.assign(existing, data, { id: existing.id, createdAt: existing.createdAt });
      existing.updatedAt = nowInTaipei();
    });
    return existing;
  }
  const student = {
    id: newId(),
    ...data,
    createdAt: nowInTaipei(),
    updatedAt: nowInTaipei(),
  };
  mutate((db) => db.students.push(student));
  return student;
}

export function updateStudent(id, input) {
  const student = findStudentById(id);
  if (!student) throw notFound('找不到這位學生。');
  const merged = normalizeStudentInput({ ...student, ...input });
  const errors = validateStudent(merged);
  if (errors.length) throw badRequest(errors.join('\n'));

  const clash = findStudentByIdNumber(merged.idNumber);
  if (clash && clash.id !== student.id) {
    throw badRequest('這個身分證字號已經被其他學生使用了。');
  }
  mutate(() => {
    Object.assign(student, merged);
    student.updatedAt = nowInTaipei();
  });
  return decorateStudent(student);
}

/** 刪除學生，連同他所有的報名紀錄。 */
export function deleteStudent(id) {
  const student = findStudentById(id);
  if (!student) throw notFound('找不到這位學生。');
  let removed = 0;
  mutate((db) => {
    db.students = db.students.filter((s) => s.id !== student.id);
    const before = db.registrations.length;
    db.registrations = db.registrations.filter((r) => r.studentId !== student.id);
    removed = before - db.registrations.length;
  });
  return { deleted: student.name, removedRegistrations: removed };
}

/** 學生總表搜尋：姓名、身分證、學校、區域、電話、LINE ID、Email、監護人都吃得到。 */
export function searchStudents(query = '') {
  const q = toHalfWidth(String(query)).trim().toLowerCase();
  const all = getDb().students.map(decorateStudent);
  const sorted = all.sort((a, b) => String(b.lastRegisteredAt || b.createdAt)
    .localeCompare(String(a.lastRegisteredAt || a.createdAt)));
  if (!q) return sorted;
  const haystack = (s) => [
    s.name, s.idNumber, s.school, s.district, s.address, s.mobile, s.homePhone,
    s.lineId, s.email, s.guardianName, s.guardianPhone, s.grade, s.gender,
    s.identityType, (s.familyStatus || []).join(' '), s.birthDate, s.birthDateRoc,
  ].join(' ').toLowerCase();
  return sorted.filter((s) => haystack(s).includes(q));
}

// ---------------------------------------------------------------- 報名

function normalizeAnswers(input = {}) {
  const answers = {};
  for (const field of REGISTRATION_FIELDS) {
    const raw = input[field.key];
    answers[field.key] = field.type === 'checkbox'
      ? toArray(raw)
      : toHalfWidth(String(raw ?? '')).trim();
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

export function findRegistration(id) {
  return getDb().registrations.find((r) => r.id === id) || null;
}

export function hasRegistered(activityId, studentId) {
  return getDb().registrations.some(
    (r) => r.activityId === activityId && r.studentId === studentId,
  );
}

/**
 * 送出報名。
 *
 * - 第一次報名：帶完整 profile，建立學生主檔後報名。
 * - 老朋友報名：帶 studentId（由 lookupStudent 取得），profile 可省略；
 *   若有帶 profile 就順便更新主檔（例如換學校、升年級、換手機）。
 */
export function register({ activity, profile, studentId, answers: rawAnswers }) {
  if (!isOpenForRegistration(activity)) {
    throw badRequest('這個活動目前沒有開放報名。');
  }

  let student = studentId ? findStudentById(studentId) : null;
  if (profile && Object.keys(profile).length) {
    const data = normalizeStudentInput(student ? { ...student, ...profile } : profile);
    const errors = validateStudent(data);
    if (errors.length) throw badRequest(errors.join('\n'));
    const clash = findStudentByIdNumber(data.idNumber);
    if (student && clash && clash.id !== student.id) {
      throw badRequest('這個身分證字號已經被其他學生使用了。');
    }
    student = upsertStudent(data);
  }
  if (!student) throw badRequest('查不到報名者資料，請改用完整報名表。');

  const answers = normalizeAnswers(rawAnswers);
  const errors = validateAnswers(answers);
  if (errors.length) throw badRequest(errors.join('\n'));

  if (hasRegistered(activity.id, student.id)) {
    throw conflict('你已經報名過這個活動了，不用重複報名。');
  }
  const decorated = decorateActivity(activity);
  if (decorated.isFull) throw conflict('這個活動已經額滿了。');

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
  mutate((db) => db.registrations.push(registration));
  backupDaily();

  return { registration, student: decorateStudent(student), activity: decorateActivity(activity) };
}

/** 取消/刪除某一筆報名（學生主檔會保留）。 */
export function deleteRegistration(id) {
  const registration = findRegistration(id);
  if (!registration) throw notFound('找不到這筆報名紀錄。');
  const student = findStudentById(registration.studentId);
  mutate((db) => {
    db.registrations = db.registrations.filter((r) => r.id !== id);
  });
  return { deleted: student ? student.name : '（資料已刪除）' };
}

export function setRegistrationNote(id, note) {
  const registration = findRegistration(id);
  if (!registration) throw notFound('找不到這筆報名紀錄。');
  mutate(() => { registration.note = String(note ?? '').trim(); });
  return registration;
}

/** 把報名紀錄攤平成名冊/匯出用的一列資料。 */
export function buildRoster(activity) {
  const db = getDb();
  return db.registrations
    .filter((r) => r.activityId === activity.id)
    .sort((a, b) => a.registeredAt.localeCompare(b.registeredAt))
    .map((r, index) => {
      const student = db.students.find((s) => s.id === r.studentId);
      const base = student ? decorateStudent(student) : {};
      return {
        seq: index + 1,
        registrationId: r.id,
        studentId: r.studentId,
        registeredAt: r.registeredAt,
        activityTitle: activity.title,
        ageAtEvent: r.ageAtEvent,
        note: r.note || '',
        ...base,
        ...r.answers,
      };
    });
}

export function stats() {
  const db = getDb();
  const activities = db.activities.map(decorateActivity);
  return {
    activityCount: activities.length,
    upcomingCount: activities.filter((a) => !a.isPast).length,
    pastCount: activities.filter((a) => a.isPast).length,
    studentCount: db.students.length,
    registrationCount: db.registrations.length,
  };
}

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
