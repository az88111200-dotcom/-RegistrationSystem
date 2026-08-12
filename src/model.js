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
// 排課日期的算法跟後台的挑選器共用同一份，兩邊才不會算出不同結果
import {
  datesByPattern, normalizeDates, weekdayOf, MAX_SESSIONS,
} from '../public/assets/schedule.js';

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
  const waitlistCount = activity.waitlistCount ?? 0;
  const capacity = Number(activity.capacity) || 0;
  const isFull = capacity > 0 && registrationCount >= capacity;
  const waitlistOpen = activity.waitlistOpen !== false;
  const waitlistCapacity = Number(activity.waitlistCapacity) || 0;
  // 額滿之後還收不收候補：要有開放，而且候補名額還沒滿
  const waitlistFull = waitlistCapacity > 0 && waitlistCount >= waitlistCapacity;
  return {
    ...activity,
    registrationCount,
    waitlistCount,
    waitlistOpen,
    waitlistCapacity,
    isPast: isPast(activity),
    isOpen: isOpenForRegistration(activity),
    isFull,
    // 額滿了，但還可以排候補 —— 前台要講清楚「現在報名是排候補」
    acceptingWaitlist: isFull && waitlistOpen && !waitlistFull,
    remainingSlots: capacity > 0 ? Math.max(0, capacity - registrationCount) : null,
    waitlistRemaining: waitlistCapacity > 0 ? Math.max(0, waitlistCapacity - waitlistCount) : null,
  };
}

/**
 * 依日期排序：即將舉行的由近到遠，過往活動由新到舊。
 *
 * includeUnlisted 預設 false —— 封閉式團體（不對外招生）不會出現在
 * 前台的任何清單裡，只有後台跟拿到連結的人看得到。
 */
export async function listActivities(scope = 'all', { includeUnlisted = false } = {}) {
  const counts = await repo.sessionCounts();
  const all = (await repo.allActivities())
    .filter((a) => includeUnlisted || !a.unlisted)
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
  if (input.waitlistCapacity !== undefined) {
    const n = Number(input.waitlistCapacity);
    out.waitlistCapacity = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  if (input.waitlistOpen !== undefined) out.waitlistOpen = Boolean(input.waitlistOpen);
  if (input.closed !== undefined) out.closed = Boolean(input.closed);
  if (input.unlisted !== undefined) out.unlisted = Boolean(input.unlisted);
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

  // 場次先算好再建活動。日期有問題時整個請求就退回去，
  // 不會在資料庫裡留下一個沒有任何場次的空活動。
  const wanted = resolveSessionList(input, data.eventDate, data.eventTime);

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
    waitlistOpen: data.waitlistOpen ?? true,
    waitlistCapacity: data.waitlistCapacity ?? 0,
    registrationDeadline: data.registrationDeadline || '',
    contact: data.contact || '',
    closed: data.closed ?? false,
    programCategory: data.programCategory || '',
    serviceType: data.serviceType || '',
    subCategory: data.subCategory || '',
    unlisted: data.unlisted ?? false,
    createdAt: nowInTaipei(),
  };
  const created = await repo.insertActivity(activity);

  await repo.insertSessions(wanted.map((s) => ({ ...s, id: newId(), activityId: activity.id })));
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
  await repo.updateActivityRow(existing.id, merged);

  // 編輯時也可以調整上課日期與各堂時間。改完要重新讀一次，
  // event_date / end_date 會跟著場次一起被更新。
  if (input.sessions !== undefined || input.sessionDates !== undefined
      || input.seriesEnd !== undefined) {
    await syncSessions(existing.id, resolveSessionList(input, merged.eventDate, merged.eventTime));
  }
  return decorateActivity(await repo.findActivityRow(existing.id));
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
    // 名額滿了就排候補；候補也滿了（或這個活動不收候補）才擋下來。
    // 整段都在 advisory lock 裡，同時有很多人送出也不會超收。
    const capacity = Number(activity.capacity) || 0;
    const counts = await repo.countRegistrations(activity.id, client);
    const full = capacity > 0 && counts.confirmed >= capacity;

    let status = 'confirmed';
    let waitlistPosition = 0;
    if (full) {
      if (!activity.waitlistOpen) throw conflict('這個活動已經額滿了。');
      const waitCap = Number(activity.waitlistCapacity) || 0;
      if (waitCap > 0 && counts.waitlist >= waitCap) {
        throw conflict('這個活動已經額滿，候補名單也滿了。');
      }
      status = 'waitlist';
      waitlistPosition = counts.waitlist + 1;
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
      status,
    };
    await repo.insertRegistration(registration, client);
    return {
      registration,
      student: decorateStudent(student),
      waitlisted: status === 'waitlist',
      waitlistPosition,
    };
  });
}

/** 取消/刪除某一筆報名（學生主檔會保留）。 */
/**
 * 刪除一筆報名。
 *
 * 刪掉的如果是正取，就把候補名單第一位遞補上來 —— 不然 30 個名額
 * 會變成只有 29 個人來，候補在那邊等也等不到。
 * 整段包在同一個 activity 鎖裡，避免同時有兩個人取消時遞補到同一位。
 */
export async function deleteRegistration(id) {
  const existing = await repo.findRegistration(id);
  if (!existing) throw notFound('找不到這筆報名紀錄。');

  return withLock(`activity:${existing.activityId}`, async (client) => {
    const result = await repo.deleteRegistrationRow(id);
    if (!result) throw notFound('找不到這筆報名紀錄。');

    let promoted = null;
    if (result.status !== 'waitlist') {
      const activity = await repo.findActivityRow(result.activityId, client);
      const capacity = Number(activity?.capacity) || 0;
      const counts = await repo.countRegistrations(result.activityId, client);
      if (capacity > 0 && counts.confirmed < capacity) {
        const next = await repo.firstWaitlisted(result.activityId, client);
        if (next) {
          await repo.setRegistrationStatus(next.id, 'confirmed', client);
          promoted = next.name;
        }
      }
    }
    return { ...result, promoted };
  });
}

/** 工作人員手動把某位候補改成正取（例如確定有人不來）。 */
export async function promoteRegistration(id) {
  const existing = await repo.findRegistration(id);
  if (!existing) throw notFound('找不到這筆報名紀錄。');
  if (existing.status !== 'waitlist') throw badRequest('這筆已經是正取了。');
  await repo.setRegistrationStatus(id, 'confirmed');
  return { promoted: true };
}

export async function setRegistrationNote(id, note) {
  const ok = await repo.setRegistrationNoteRow(id, String(note ?? '').trim());
  if (!ok) throw notFound('找不到這筆報名紀錄。');
  return { ok: true };
}

/** 把報名紀錄攤平成名冊/匯出用的一列資料。 */
/**
 * 報名名冊。正取排前面、候補排後面，各自從 1 開始編號 ——
 * 候補的人要能看懂自己是「候補第 2 位」，跟正取混在一起編號沒有意義。
 */
export async function buildRoster(activity) {
  const rows = await repo.rosterRows(activity.id);
  let confirmedSeq = 0;
  let waitSeq = 0;
  return rows.map((row) => {
    const student = decorateStudent({
      id: row.student_id,
      ...row.profile,
      idNumber: row.id_number,
      name: row.name,
      birthDate: row.birth_date,
      createdAt: row.student_created_at,
    });
    const waitlisted = row.status === 'waitlist';
    if (waitlisted) waitSeq += 1; else confirmedSeq += 1;
    return {
      seq: waitlisted ? waitSeq : confirmedSeq,
      registrationId: row.id,
      studentId: row.student_id,
      status: row.status || 'confirmed',
      waitlisted,
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
    isPast: isPast({ eventDate: row.event_date, endDate: row.end_date }),
    status: row.status || 'confirmed',
    registrationId: row.registration_id,
    registeredAt: row.registered_at,
  }));
}

/**
 * 少年自己查「我報名過哪些活動」。
 *
 * 這是公開的查詢，所以刻意只認姓名 + 身分證兩項，回傳的內容也只有
 * 活動本身與正取／候補狀態 —— 不回傳學校、地址、電話這些個人資料。
 * 兩項都對才給資料；對不上時一律回同一句話，不透露身分證存不存在。
 */
export async function myRegistrations({ name, idNumber }) {
  const cleanName = toHalfWidth(String(name || '')).replace(/\s+/g, '').trim();
  const id = normalizeIdNumber(idNumber);
  if (!cleanName || !id) throw badRequest('請輸入姓名與身分證字號。');

  const student = await repo.findStudentByIdNumber(id);
  const nameMatches = student
    && String(student.name).replace(/\s+/g, '') === cleanName;
  if (!nameMatches) return { found: false };

  const rows = await repo.studentHistoryRows(student.id);
  return {
    found: true,
    name: student.name,
    registrations: rows.map((row) => ({
      activityTitle: row.title,
      activitySlug: row.slug,
      eventDate: row.event_date,
      endDate: row.end_date || row.event_date,
      eventTime: row.event_time || '',
      location: row.location || '',
      registeredAt: row.registered_at,
      waitlisted: row.status === 'waitlist',
      waitlistPosition: Number(row.waitlist_position) || 0,
      isPast: isPast({ eventDate: row.event_date, endDate: row.end_date }),
    })),
  };
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

  // 預設看實際出席：政府月報要的是服務量，不是報名數。
  // 「依報名月份」拿掉了 —— 報名當下的月份跟服務發生的月份常常不同，
  // 對月報沒有意義，留著只會讓人選錯。
  const basis = input.basis === 'event' ? 'event' : 'attendance';
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

/**
 * 產生連續性課程的場次。
 * 例：水電課 7/1 到 8/31 的每週三 → 產出 9 個場次。
 *
 * pattern：daily（每一天）／weekly（每週）／biweekly（隔週）。
 * 舊的呼叫方式只給 weekdays（空陣列代表每一天），這裡照樣支援。
 */
export function generateSessionDates(startDate, endDate, weekdays = [], pattern = '') {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw badRequest('請填寫正確的起訖日期。');
  }
  if (endDate < startDate) throw badRequest('結束日期不能早於開始日期。');

  const list = Array.isArray(weekdays) ? weekdays : [];
  const mode = pattern || (list.length ? 'weekly' : 'daily');
  const dates = datesByPattern(startDate, endDate, mode, list);

  if (dates.length > MAX_SESSIONS) {
    throw badRequest(`場次太多了（超過 ${MAX_SESSIONS} 場），請確認日期是否填錯。`);
  }
  if (!dates.length) throw badRequest('這段期間內沒有符合的日期，請確認星期選對了。');
  return dates;
}

/** 檢查並整理一個場次的時間，沒填就沿用活動時間。 */
function cleanSessionTime(item, [defaultStart, defaultEnd]) {
  const startTime = String(item.startTime ?? '').trim();
  const endTime = String(item.endTime ?? '').trim();
  if (startTime && !TIME_RE.test(startTime)) throw badRequest(`開始時間格式不正確：${startTime}`);
  if (endTime && !TIME_RE.test(endTime)) throw badRequest(`結束時間格式不正確：${endTime}`);
  if (startTime && endTime && endTime <= startTime) {
    throw badRequest(`結束時間要晚於開始時間：${startTime}-${endTime}`);
  }
  // 這一堂完全沒填時間才套用活動時間；只填了開始時間就照他填的來
  if (!startTime && !endTime) return { startTime: defaultStart, endTime: defaultEnd };
  return { startTime, endTime };
}

/**
 * 決定這個活動要排哪些場次（日期，以及那一堂自己的時間）。
 *
 * 後台的日期挑選器會直接送一整串 sessions 過來（可以任意增減日期，
 * 也可以單獨改某一堂的時間），這是現在的主要做法。
 * sessionDates 是只有日期的簡寫；seriesEnd + weekdays 是舊版的規律排課。
 * 兩個都沒有就是單日活動。時間留白的場次一律沿用活動時間。
 */
function resolveSessionList(input, eventDate, eventTime) {
  const fallback = splitTimeRange(eventTime);
  // 呼叫的人只給了日期，那就別去動既有場次自己的時間 —— keepTime 是這個意思，
  // 新加的那幾堂沒有舊時間可留，才套用活動時間。
  const withDefaults = (dates) => dates.map((date) => ({
    date, startTime: fallback[0], endTime: fallback[1], title: '', keepTime: true,
  }));

  if (Array.isArray(input.sessions)) {
    const seen = new Set();
    const list = [];
    for (const item of input.sessions) {
      const date = String(item.date || '').trim();
      if (!DATE_RE.test(date)) throw badRequest(`上課日期格式不正確：${date || '(空白)'}`);
      const key = `${date} ${item.startTime || ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      list.push({ date, ...cleanSessionTime(item, fallback), title: String(item.title || '').trim() });
    }
    if (!list.length) throw badRequest('請至少選一個上課日期。');
    if (list.length > MAX_SESSIONS) {
      throw badRequest(`場次太多了（超過 ${MAX_SESSIONS} 場），請確認日期是否填錯。`);
    }
    return list.sort((a, b) => (a.date + a.startTime).localeCompare(b.date + b.startTime));
  }

  if (input.sessionDates !== undefined) {
    const dates = normalizeDates(input.sessionDates);
    if (!dates.length) throw badRequest('請至少選一個上課日期。');
    if (dates.length > MAX_SESSIONS) {
      throw badRequest(`場次太多了（超過 ${MAX_SESSIONS} 場），請確認日期是否填錯。`);
    }
    return withDefaults(dates);
  }
  if (input.seriesEnd) {
    const weekdays = Array.isArray(input.weekdays)
      ? input.weekdays
      : String(input.weekdays || '').split(',').filter(Boolean);
    return withDefaults(generateSessionDates(
      eventDate, String(input.seriesEnd).trim(), weekdays, input.seriesPattern || '',
    ));
  }
  return withDefaults([eventDate]);
}

export async function listSessions(activityId) {
  return repo.sessionsOf(activityId);
}

/**
 * 把活動的場次調整成指定的清單（日期 + 那一堂的時間）。
 *
 * 日期沒變的場次原地更新，不重建 —— 場次代號一換，掛在上面的簽到紀錄
 * 就會跟著被刪掉，月報的出席人次會平白少一截。所以改時間也不會動到簽到。
 *
 * 要移除的那一天如果已經有人簽到，就擋下來請工作人員自己處理，
 * 不要默默把出席紀錄丟掉；這些數字是要交給政府的。
 */
export async function syncSessions(activityId, list) {
  if (!list.length) throw badRequest('活動至少要有一個上課日期。');

  const existing = await repo.sessionsOf(activityId);

  // 同一天可能不只一堂（早上一堂、下午一堂），所以照日期分組再一一對應
  const byDate = new Map();
  for (const s of existing) {
    if (!byDate.has(s.date)) byDate.set(s.date, []);
    byDate.get(s.date).push(s);
  }

  const row = (s) => ({
    date: s.date, startTime: s.startTime, endTime: s.endTime, title: s.title || '',
  });
  const updates = [];
  const adding = [];
  const used = new Set();
  for (const want of list) {
    const pool = byDate.get(want.date) || [];
    const match = pool.find((s) => !used.has(s.id));
    if (match) {
      used.add(match.id);
      if (want.keepTime) continue;
      const changed = match.startTime !== want.startTime || match.endTime !== want.endTime
        || match.title !== (want.title || '');
      if (changed) updates.push({ id: match.id, ...row(want) });
    } else {
      adding.push({ id: newId(), activityId, ...row(want) });
    }
  }

  const removing = existing.filter((s) => !used.has(s.id));
  const signed = removing.filter((s) => (s.attendanceCount || 0) > 0);
  if (signed.length) {
    const dates = signed.map((s) => `${s.date}（${s.attendanceCount} 人）`).join('、');
    throw conflict(
      `這些日期已經有人簽到，不能直接移除：${dates}。`
      + '請先到「簽到與出席」把那幾筆簽到紀錄移除，再回來調整日期。',
    );
  }

  // 先刪再改再加，免得改時間的過程中跟待刪的場次撞到同日同時段
  for (const s of removing) await repo.deleteSession(s.id);
  for (const s of updates) await repo.updateSession(s.id, s);
  if (adding.length) await repo.insertSessions(adding);
  await repo.syncActivityDates(activityId);
  return repo.sessionsOf(activityId);
}

/**
 * 重新設定某個活動的所有場次。
 * 傳進來的清單就是最終結果，沒列到的場次會被刪掉。
 */
export async function replaceSessions(activityId, list) {
  const activity = await repo.findActivityRow(activityId);
  if (!activity) throw notFound('找不到這個活動。');
  return syncSessions(activityId, resolveSessionList(
    { sessions: list }, activity.eventDate, activity.eventTime,
  ));
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
export async function checkIn({ sessionId, studentId, name, birthDate, idNumber, method = 'qr' }) {
  const session = await repo.findSession(sessionId);
  if (!session) throw notFound('找不到這個場次，請確認選的課程正確。');

  let student;
  if (studentId) {
    // 後台在名單上直接點某個人補簽到 —— 已經知道是誰了，不用再查名字
    student = await repo.findStudentById(studentId);
    if (!student) throw notFound('找不到這位少年的資料。');
  } else {
    const cleanName = toHalfWidth(String(name || '')).replace(/\s+/g, ' ').trim();
    if (!cleanName) throw badRequest('請輸入你的姓名。');

    const resolved = await resolveStudentForCheckin({
      activityId: session.activityId, name: cleanName, birthDate, idNumber,
    });
    // 同名太多、需要再問生日時先原路返回，前台會多顯示一個欄位
    if (resolved.needsBirthDate) return resolved;
    student = resolved.student;
  }

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
/**
 * 某一場的簽到名單，外加「報名了但還沒簽到」的人。
 *
 * 有了 pending，補簽到就不用一個一個打名字：現場忘了掃碼、
 * 或是拿著紙本簽到表回來補登時，直接在名單上按一下就好。
 */
export async function sessionAttendance(sessionId) {
  const session = await repo.findSession(sessionId);
  if (!session) throw notFound('找不到這個場次。');
  const activity = await repo.findActivityRow(session.activityId);
  const rows = await repo.attendanceRows(sessionId);

  const signedIn = new Set(rows.map((r) => r.student_id));
  const roster = activity ? await buildRoster(decorateActivity(activity)) : [];
  const pending = roster
    .filter((r) => !signedIn.has(r.studentId))
    .map((r) => ({
      studentId: r.studentId,
      name: r.name,
      district: r.district || '',
      school: r.school || '',
      waitlisted: Boolean(r.waitlisted),
    }));

  return {
    session,
    activity: activity ? decorateActivity(activity) : null,
    pending,
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
