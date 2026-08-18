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
  // 前後測各自獨立開關：上課前開前測，最後一堂再開後測
  if (input.preSurveyOpen !== undefined) out.preSurveyOpen = Boolean(input.preSurveyOpen);
  if (input.postSurveyOpen !== undefined) out.postSurveyOpen = Boolean(input.postSurveyOpen);
  for (const key of ['minAge', 'maxAge']) {
    if (input[key] === undefined) continue;
    const n = Number(input[key]);
    out[key] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
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

/** 招收年齡：兩個都填的話，下限不能大於上限。 */
function validateAgeRange(data) {
  const min = Number(data.minAge) || 0;
  const max = Number(data.maxAge) || 0;
  if (min && max && min > max) throw badRequest('招收年齡的下限不能大於上限。');
}

/**
 * 這個人的年齡符不符合活動的招收年齡。
 *
 * 不符也照樣收 —— 只是錄取時原定年齡優先，所以這裡只負責回報，不擋人。
 * 年齡以第一堂課那天為準，跟名冊上的「參加者年齡」同一個基準。
 */
export function checkAge(activity, birthDate) {
  const min = Number(activity.minAge) || 0;
  const max = Number(activity.maxAge) || 0;
  const age = ageOn(birthDate, activity.eventDate);
  if ((!min && !max) || age === '') return { age, ok: true };
  return { age, ok: !((min && age < min) || (max && age > max)) };
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
  validateAgeRange(data);

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
    preSurveyOpen: data.preSurveyOpen ?? false,
    postSurveyOpen: data.postSurveyOpen ?? false,
    minAge: data.minAge ?? 0,
    maxAge: data.maxAge ?? 0,
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
  validateAgeRange({ ...existing, ...data });

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
      // 年齡不符還是收，前台要把「原定年齡優先」講清楚
      ageMismatch: !checkAge(activity, student.birthDate).ok,
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
      // 年齡符不符合是即時算的，不存下來 —— 之後改招收年齡，名單會跟著更新
      ageMismatch: !checkAge(activity, row.birth_date).ok,
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

  const [stats, months, subCategories, manual, manualMonths] = await Promise.all([
    repo.reportStats(filter),
    repo.reportMonths(basis),
    repo.usedSubCategories(),
    repo.manualCounts(filter),
    repo.manualCountMonths(),
  ]);

  // 地區依新北市的既定順序排，年齡由小到大，這樣每個月的報表長得一樣
  const districtOrder = new Map(NTPC_DISTRICTS.map((d, i) => [d, i]));
  stats.byDistrict.sort((a, b) => (districtOrder.get(a.key) ?? 999) - (districtOrder.get(b.key) ?? 999));
  stats.byAge.sort((a, b) => ageOrder(a.key) - ageOrder(b.key));

  // 系統算出來的與工作人員手動填的分開放，最後再加總 ——
  // 交出去的數字才講得清楚哪些有簽到紀錄可查、哪些是人工補的
  const counted = {
    registrations: Number(stats.totals.registrations) || 0,
    people: Number(stats.totals.people) || 0,
    activities: Number(stats.totals.activities) || 0,
    sessions: Number(stats.totals.sessions) || 0,
  };
  const manualTotals = manual.reduce((acc, m) => ({
    registrations: acc.registrations + m.headcount,
    people: acc.people + m.people,
    activities: acc.activities + 1,
    sessions: acc.sessions + m.sessions,
  }), { registrations: 0, people: 0, activities: 0, sessions: 0 });

  return {
    month,
    basis,
    filter,
    // 手動人次自己也會用到月份，兩邊的月份合起來才選得到
    months: [...new Set([...months, ...manualMonths])].sort().reverse(),
    subCategories,
    programCategories: PROGRAM_CATEGORIES,
    serviceTypes: SERVICE_TYPES,
    totals: {
      // 出席基準時這個數字是「出席人次」，報名基準時是「報名人次」
      registrations: counted.registrations + manualTotals.registrations,
      people: counted.people + manualTotals.people,
      activities: counted.activities + manualTotals.activities,
      sessions: counted.sessions + manualTotals.sessions,
    },
    counted,
    manualTotals,
    manualCounts: manual,
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

/**
 * 活動管理的「按月統計」。
 *
 * 以每一堂課的日期分月，而不是用活動日期 —— 跨月的連續性團體
 * （或整年開的團體）每個月都要看得到自己那幾堂，人次才算得對。
 *
 * 一個活動在幾個月有課，就會出現在那幾個月，每次只帶那個月的堂數與簽到。
 * 手動填入的人次也一併帶上，這樣這頁的數字跟月報對得起來。
 */
export async function activityMonths() {
  const [rows, peopleByMonth, list, manual] = await Promise.all([
    repo.sessionAttendanceRows(),
    repo.attendancePeopleByMonth(),
    listActivities('all', { includeUnlisted: true }),
    repo.manualCounts(),
  ]);

  const byId = new Map(list.map((a) => [a.id, a]));
  const months = new Map();
  const monthOf = (key) => {
    if (!months.has(key)) {
      months.set(key, {
        month: key,
        sessions: 0,
        attendance: 0,
        people: peopleByMonth.get(key) || 0,
        manualHeadcount: 0,
        manualPeople: 0,
        manualCount: 0,
        byActivity: new Map(),
      });
    }
    return months.get(key);
  };

  for (const row of rows) {
    const activity = byId.get(row.activity_id);
    if (!activity) continue;
    const month = monthOf(row.month);
    month.sessions += 1;
    month.attendance += row.attendance;

    if (!month.byActivity.has(activity.id)) {
      month.byActivity.set(activity.id, {
        id: activity.id,
        title: activity.title,
        slug: activity.slug,
        eventDate: activity.eventDate,
        endDate: activity.endDate || activity.eventDate,
        sessionCount: activity.sessionCount,
        capacity: activity.capacity,
        registrationCount: activity.registrationCount,
        waitlistCount: activity.waitlistCount,
        programCategory: activity.programCategory || '',
        serviceType: activity.serviceType || '',
        subCategory: activity.subCategory || '',
        unlisted: activity.unlisted === true,
        isPast: activity.isPast,
        monthSessions: 0,
        monthAttendance: 0,
        monthDates: [],
      });
    }
    const item = month.byActivity.get(activity.id);
    item.monthSessions += 1;
    item.monthAttendance += row.attendance;
    item.monthDates.push(row.session_date);
  }

  for (const m of manual) {
    const month = monthOf(m.month);
    month.manualHeadcount += m.headcount;
    month.manualPeople += m.people;
    month.manualCount += 1;
  }

  return [...months.values()]
    .map(({ byActivity, ...m }) => ({
      ...m,
      activityCount: byActivity.size,
      activities: [...byActivity.values()]
        .sort((a, b) => String(a.monthDates[0]).localeCompare(String(b.monthDates[0]))),
    }))
    .sort((a, b) => b.month.localeCompare(a.month));
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

// ---------------------------------------------------------------- 行事曆

/** 那個月的第一天與最後一天。 */
function monthRange(month) {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}

/**
 * 一個月的行事曆。
 *
 * 以「場次」為單位而不是「活動」—— 連續性課程的每一堂都要各自出現在
 * 自己那天的格子裡，不然行事曆上只看得到開課那一天。
 * 封閉式團體（不對外公開）不會出現。
 */
export async function calendarMonth(month) {
  const target = MONTH_RE.test(String(month || '')) ? month : todayInTaipei().slice(0, 7);
  const [from, to] = monthRange(target);
  const rows = await repo.sessionsBetween(from, to);
  const today = todayInTaipei();

  const days = new Map();
  for (const s of rows) {
    if (s.unlisted) continue;
    const activity = {
      closed: s.closed,
      registrationDeadline: s.registrationDeadline,
      eventDate: s.eventDate,
      endDate: s.endDate,
    };
    const isFull = s.capacity > 0 && s.registrationCount >= s.capacity;
    if (!days.has(s.date)) days.set(s.date, []);
    days.get(s.date).push({
      slug: s.slug,
      title: s.activityTitle,
      sessionTitle: s.title || '',
      startTime: s.startTime || '',
      endTime: s.endTime || '',
      isPast: s.date < today,
      // 額滿與否照舊要講，但不寫人數 —— 前台一律不透露已報名幾人
      isFull,
      isOpen: isOpenForRegistration(activity) && !isFull,
    });
  }

  return {
    month: target,
    today,
    days: [...days.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, items]) => ({ date, items })),
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

// ---------------------------------------------------------------- 前後測

/**
 * 題型。
 *
 * scale 是前後測的主力 —— 1 到 5 分，前後相減就知道進步幾分。
 * 其餘三種是輔助：單選看分佈、複選看勾了哪些、簡答留質性的話。
 */
export const QUESTION_TYPES = ['scale', 'single', 'multi', 'text'];
export const QUESTION_TYPE_LABELS = {
  scale: '1-5 分量表',
  single: '單選',
  multi: '複選',
  text: '簡答',
};
/** 量表的固定選項。全園統一，前後測與跨活動才比得起來。 */
export const SCALE_LABELS = ['非常不同意', '不同意', '普通', '同意', '非常同意'];

const PHASES = ['pre', 'post'];

function cleanQuestionInput(input) {
  const text = String(input.text ?? '').trim();
  const type = String(input.type ?? 'scale').trim();
  if (!QUESTION_TYPES.includes(type)) throw badRequest('題型不正確。');
  const options = toArray(input.options).map((o) => String(o).trim()).filter(Boolean);
  if ((type === 'single' || type === 'multi') && options.length < 2) {
    throw badRequest('單選與複選至少要有兩個選項。');
  }
  return {
    text,
    type,
    // 量表與簡答不需要選項，存空的免得改題型之後留下用不到的舊選項
    options: type === 'single' || type === 'multi' ? options : [],
    category: String(input.category ?? '').trim(),
    archived: Boolean(input.archived),
    sortOrder: Number.isFinite(Number(input.sortOrder)) ? Math.floor(Number(input.sortOrder)) : 0,
  };
}

export async function listQuestions() {
  return repo.allQuestions();
}

export async function createQuestion(input) {
  const data = cleanQuestionInput(input);
  if (!data.text) throw badRequest('請填寫題目。');
  return repo.insertQuestion({ ...data, id: newId(), createdAt: nowInTaipei() });
}

export async function updateQuestion(id, input) {
  const existing = await repo.findQuestion(id);
  if (!existing) throw notFound('找不到這一題。');
  const data = cleanQuestionInput({ ...existing, ...input });
  if (!data.text) throw badRequest('題目不能空白。');
  return repo.updateQuestionRow(id, data);
}

/**
 * 刪題目。
 *
 * 已經被活動用過的題目不刪 —— 舊活動的作答是照題目代號存的，
 * 題目一刪，那些數字就再也對不回是在問什麼。改成請工作人員「停用」，
 * 停用之後挑題時看不到，但歷史資料還讀得出來。
 */
export async function deleteQuestion(id) {
  const existing = await repo.findQuestion(id);
  if (!existing) throw notFound('找不到這一題。');
  const used = await repo.questionUsage(id);
  if (used > 0) {
    throw conflict(
      `這一題已經有 ${used} 個活動用過，不能刪除（刪了那些活動的作答就對不回題目）。`
      + '請改成「停用」，之後挑題時就不會出現了。',
    );
  }
  await repo.deleteQuestionRow(id);
  return { deleted: existing.text };
}

export async function listActivityQuestions(activityId) {
  return repo.questionsOfActivity(activityId);
}

/**
 * 設定這個活動要用哪幾題。
 *
 * 傳進來的清單就是最終結果，順序照陣列本身。
 * phase 決定這一題出現在前測、後測、還是兩邊都問 ——
 * 要比較前後差異的題目一定要選 both，只出現一邊的題目沒得比。
 */
export async function setActivityQuestions(activityId, list) {
  const activity = await repo.findActivityRow(activityId);
  if (!activity) throw notFound('找不到這個活動。');

  const picks = [];
  const seen = new Set();
  for (const [i, item] of toArray(list).entries()) {
    const questionId = String(item.questionId ?? item.id ?? '').trim();
    if (!questionId || seen.has(questionId)) continue;
    const question = await repo.findQuestion(questionId);
    if (!question) throw badRequest('挑到了不存在的題目，請重新整理後再試一次。');
    const phase = ['pre', 'post', 'both'].includes(item.phase) ? item.phase : 'both';
    seen.add(questionId);
    picks.push({ id: newId(), questionId, phase, sortOrder: i });
  }
  return repo.replaceActivityQuestions(activity.id, picks);
}

/** 這一份（前測或後測）要問哪幾題。 */
function questionsForPhase(questions, phase) {
  return questions.filter((q) => q.phase === 'both' || q.phase === phase);
}

/**
 * 前台要填的那份問卷。
 * 沒挑題、或那一份沒開放時，前台要看得到明確的原因，不要只是一片空白。
 */
export async function surveyForm(slugOrId, phase) {
  if (!PHASES.includes(phase)) throw notFound('找不到這份問卷。');
  const activity = await repo.findActivityRow(slugOrId);
  if (!activity) throw notFound('找不到這個活動。');

  const all = await repo.questionsOfActivity(activity.id);
  const questions = questionsForPhase(all, phase);
  const open = phase === 'pre' ? activity.preSurveyOpen : activity.postSurveyOpen;
  return {
    activity: { title: activity.title, slug: activity.slug, eventDate: activity.eventDate },
    phase,
    open: open === true && questions.length > 0,
    hasQuestions: questions.length > 0,
    scaleLabels: SCALE_LABELS,
    questions: questions.map((q) => ({
      id: q.id, text: q.text, type: q.type, options: q.options, category: q.category,
    })),
  };
}

/** 把送上來的答案照題型整理乾淨，順便擋掉不是這份問卷的題目。 */
function cleanAnswers(questions, raw) {
  const out = {};
  const missing = [];
  for (const q of questions) {
    const value = raw?.[q.id];
    if (q.type === 'multi') {
      const picked = toArray(value).map((v) => String(v).trim())
        .filter((v) => q.options.includes(v));
      if (!picked.length) missing.push(q.text);
      else out[q.id] = picked;
      continue;
    }
    if (q.type === 'scale') {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 1 || n > 5) missing.push(q.text);
      else out[q.id] = Math.round(n);
      continue;
    }
    const text = String(value ?? '').trim();
    if (!text) missing.push(q.text);
    else if (q.type === 'single' && !q.options.includes(text)) missing.push(q.text);
    else out[q.id] = text;
  }
  return { answers: out, missing };
}

/**
 * 送出一份前測或後測。
 *
 * 認人的方式跟簽到一樣：只問姓名，同名的人太多才追問生日。
 * 現場一群少年排隊填，欄位愈少愈好。
 */
export async function submitSurvey({ slugOrId, phase, name, birthDate, idNumber, answers }) {
  if (!PHASES.includes(phase)) throw notFound('找不到這份問卷。');
  const activity = await repo.findActivityRow(slugOrId);
  if (!activity) throw notFound('找不到這個活動。');

  const open = phase === 'pre' ? activity.preSurveyOpen : activity.postSurveyOpen;
  if (!open) throw badRequest(`這個活動的${phase === 'pre' ? '前' : '後'}測目前沒有開放填寫。`);

  const all = await repo.questionsOfActivity(activity.id);
  const questions = questionsForPhase(all, phase);
  if (!questions.length) throw badRequest('這份問卷還沒有題目。');

  const cleanName = toHalfWidth(String(name || '')).replace(/\s+/g, ' ').trim();
  if (!cleanName) throw badRequest('請輸入你的姓名。');
  const resolved = await resolveStudentForCheckin({
    activityId: activity.id, name: cleanName, birthDate, idNumber,
  });
  if (resolved.needsBirthDate) return resolved;

  const { answers: clean, missing } = cleanAnswers(questions, answers);
  if (missing.length) {
    throw badRequest(`還有題目沒有作答：${missing.slice(0, 3).join('、')}${missing.length > 3 ? '…' : ''}`);
  }

  const existing = await repo.findResponse(activity.id, resolved.student.id, phase);
  await repo.upsertResponse({
    id: existing?.id || newId(),
    activityId: activity.id,
    studentId: resolved.student.id,
    phase,
    answers: clean,
    submittedAt: nowInTaipei(),
  });
  return {
    ok: true,
    studentName: resolved.student.name,
    activityTitle: activity.title,
    phase,
    // 重填會覆蓋，前台要講清楚，不然少年會以為自己交了兩份
    replaced: Boolean(existing),
  };
}

/**
 * 後台的前後測結果。
 *
 * 兩件事要一起看：
 *   1. 每個人自己的前 → 後（誰進步了、誰退步了）
 *   2. 每一題全班的平均前 → 後（這門課整體有沒有效）
 * 平均只算量表題，而且只算「前後測都有填」的人 ——
 * 只填了一邊的人算進去，平均會被沒填的那一邊拉歪。
 */
export async function surveyResults(slugOrId) {
  const activity = await repo.findActivityRow(slugOrId);
  if (!activity) throw notFound('找不到這個活動。');

  const questions = await repo.questionsOfActivity(activity.id);
  const responses = await repo.responsesOfActivity(activity.id);

  const byStudent = new Map();
  for (const r of responses) {
    if (!byStudent.has(r.studentId)) {
      byStudent.set(r.studentId, { studentId: r.studentId, name: r.name, pre: null, post: null });
    }
    byStudent.get(r.studentId)[r.phase] = r;
  }
  const people = [...byStudent.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
  const bothCount = people.filter((p) => p.pre && p.post).length;

  const scaleQuestions = questions.filter((q) => q.type === 'scale' && q.phase === 'both');
  const stats = scaleQuestions.map((q) => {
    // 只有前後都填的人才進平均，不然等於拿兩群不同的人相比
    const pairs = people
      .filter((p) => p.pre && p.post)
      .map((p) => [Number(p.pre.answers[q.id]), Number(p.post.answers[q.id])])
      .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b));
    const avg = (list) => (list.length
      ? Math.round((list.reduce((s, n) => s + n, 0) / list.length) * 100) / 100 : null);
    const pre = avg(pairs.map(([a]) => a));
    const post = avg(pairs.map(([, b]) => b));
    return {
      questionId: q.id,
      text: q.text,
      category: q.category,
      n: pairs.length,
      pre,
      post,
      diff: pre === null || post === null ? null : Math.round((post - pre) * 100) / 100,
      improved: pairs.filter(([a, b]) => b > a).length,
      same: pairs.filter(([a, b]) => b === a).length,
      dropped: pairs.filter(([a, b]) => b < a).length,
    };
  });

  return {
    activity: {
      id: activity.id, slug: activity.slug, title: activity.title,
      preSurveyOpen: activity.preSurveyOpen, postSurveyOpen: activity.postSurveyOpen,
    },
    questions: questions.map((q) => ({
      id: q.id, text: q.text, type: q.type, options: q.options, phase: q.phase, category: q.category,
    })),
    scaleLabels: SCALE_LABELS,
    counts: {
      pre: people.filter((p) => p.pre).length,
      post: people.filter((p) => p.post).length,
      both: bothCount,
    },
    stats,
    people: people.map((p) => ({
      studentId: p.studentId,
      name: p.name,
      preAt: p.pre?.submittedAt || '',
      postAt: p.post?.submittedAt || '',
      pre: p.pre?.answers || null,
      post: p.post?.answers || null,
      preId: p.pre?.id || '',
      postId: p.post?.id || '',
    })),
  };
}

export async function removeSurveyResponse(id) {
  const done = await repo.deleteResponse(id);
  if (!done) throw notFound('找不到這筆作答。');
  return { ok: true };
}

// ---------------------------------------------------------------- 手動人次

/**
 * 手動人次。
 *
 * 跟別的單位合辦時，現場常常沒辦法讓每個人掃碼簽到 —— 場地是對方的、
 * 名單在對方手上、時間也趕。這種活動的服務量還是要進月報，
 * 所以讓工作人員直接把人次填進來。
 *
 * 這些數字在月報裡跟系統算出來的分開列，交出去的報表才講得清楚
 * 哪些有簽到紀錄可查、哪些是人工補的。
 */
function cleanManualCountInput(input) {
  const month = String(input.month ?? '').trim();
  if (!MONTH_RE.test(month)) throw badRequest('請填正確的月份（例：2026-08）。');

  const title = String(input.title ?? '').trim();
  if (!title) throw badRequest('請填活動名稱。');

  const num = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
  };
  const headcount = num(input.headcount);
  if (!headcount) throw badRequest('服務人次至少要 1。');
  const people = num(input.people);
  if (people > headcount) throw badRequest('實際人數不能大於服務人次。');

  const data = {
    month,
    title,
    headcount,
    people,
    sessions: num(input.sessions, 1),
    programCategory: String(input.programCategory ?? '').trim(),
    serviceType: String(input.serviceType ?? '').trim(),
    subCategory: String(input.subCategory ?? '').trim(),
    note: String(input.note ?? '').trim(),
  };
  validateCategories(data);
  return data;
}

export async function listManualCounts(filter = {}) {
  return repo.manualCounts({
    month: String(filter.month || '').trim(),
    programCategory: String(filter.programCategory || '').trim(),
    serviceType: String(filter.serviceType || '').trim(),
    subCategory: String(filter.subCategory || '').trim(),
  });
}

export async function createManualCount(input) {
  const data = cleanManualCountInput(input);
  return repo.insertManualCount({ ...data, id: newId(), createdAt: nowInTaipei() });
}

export async function updateManualCount(id, input) {
  const existing = await repo.findManualCount(id);
  if (!existing) throw notFound('找不到這筆手動人次。');
  return repo.updateManualCountRow(id, cleanManualCountInput({ ...existing, ...input }));
}

export async function deleteManualCount(id) {
  const existing = await repo.findManualCount(id);
  if (!existing) throw notFound('找不到這筆手動人次。');
  await repo.deleteManualCountRow(id);
  return { deleted: existing.title };
}
