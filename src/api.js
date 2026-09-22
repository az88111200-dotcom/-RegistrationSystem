import { sendJson, sendCsv, sendFile, readJsonBody, clientIp } from './http.js';
import { isAuthenticated, login, logout } from './auth.js';
import {
  STUDENT_FIELDS, REGISTRATION_FIELDS, PRIVACY_NOTICE, COURSE_NOTES,
  LINE_URL, LINE_ID, AGE_MISMATCH_NOTICE, FIRST_TIME_NOTICE, CLASH_NOTICE, ageRequirementText,
} from './fields.js';
import {
  rosterCsv, insuranceCsv, studentsCsv, reportCsv, surveyCsv, safeFilename,
} from './csv.js';
import { PUBLIC_BASE_URL } from './config.js';
import {
  EQUIPMENT, ACTIVITY_TYPES, RULES_TEXT, OPENING_TEXT, PUBLIC_ONLY_HIDDEN,
  UNDER_CONSTRUCTION, CONSTRUCTION_NOTICE,
} from './booking-rules.js';
import { todayInTaipei } from './util.js';
import { readSheet } from './xlsx.js';
import {
  listActivities, activityMonths, findActivity, createActivity, updateActivity, deleteActivity,
  clashesForStudent,
  lookupStudent, register, deleteRegistration, setRegistrationNote, buildRoster,
  searchStudents, findStudentById, updateStudent, deleteStudent, hasRegistered,
  studentHistory, stats, monthlyReport, bureauMonthlySheet, listSessions, replaceSessions, removeSession,
  sessionsForCheckin, checkinStatus, checkIn, sessionAttendance, attendanceOverview, removeAttendance,
  calendarMonth, calendarCheck, calendarConfig, listQuestions, createQuestion, updateQuestion, deleteQuestion,
  listActivityQuestions, setActivityQuestions, surveyForm, submitSurvey,
  surveyResults, removeSurveyResponse, QUESTION_TYPE_LABELS, SCALE_LABELS,
  listManualCounts, createManualCount, createManualCounts, updateManualCount, deleteManualCount,
  listReportExtras, saveReportExtras, cleanupImportedBookings,
  listVenues, createVenue, updateVenue, deleteVenue,
  listBookings, createBooking, updateBooking, deleteBooking,
  cancelBooking, bookingsByPhone, createClosure, bookingCalendar, bookingStats,
  dailyBookingReport, importBookings,
  summariseSessions, promoteRegistration, setRegistrationRejected,
  myRegistrations, badRequest, notFound,
} from './model.js';

/** 前台看得到的活動資訊（不含後台備註）。 */
function publicActivity(a) {
  return {
    id: a.id, slug: a.slug, title: a.title, summary: a.summary, description: a.description,
    eventDate: a.eventDate, eventTime: a.eventTime, location: a.location,
    // 空間名稱可以給前台（就是活動在哪裡辦），但內部代號不用露出去
    venueName: (a.venueNames || []).join('、'),
    gatheringPlace: a.gatheringPlace, capacity: a.capacity, contact: a.contact,
    registrationDeadline: a.registrationDeadline, closed: a.closed, unlisted: a.unlisted,
    minAge: a.minAge, maxAge: a.maxAge, ageRequirement: ageRequirementText(a.minAge, a.maxAge),
    endDate: a.endDate, sessionCount: a.sessionCount,
    registrationCount: a.registrationCount, isPast: a.isPast, isOpen: a.isOpen,
    isFull: a.isFull, remainingSlots: a.remainingSlots,
    // 候補資訊要露到前台，讓大家看得到現在排了幾個人
    waitlistCount: a.waitlistCount, waitlistOpen: a.waitlistOpen,
    waitlistCapacity: a.waitlistCapacity, waitlistRemaining: a.waitlistRemaining,
    acceptingWaitlist: a.acceptingWaitlist,
  };
}

/*
 * 次數限制。每種用途各算各的 —— 場地借用送太多次，不該害得
 * 老朋友連身分證查詢都查不了（同一個 wifi 出去是同一個 IP）。
 */
const hits = new Map();
const WINDOW_MS = 10 * 60 * 1000;
// 本機測試會連續打很多次，所以留一個環境變數可以調高
const LIMITS = {
  lookup: Number(process.env.RATE_LIMIT_LOOKUP) || 30,
  booking: Number(process.env.RATE_LIMIT_BOOKING) || 20,
};

function lookupThrottled(ip, bucket = 'lookup') {
  const key = `${bucket}:${ip}`;
  const now = Date.now();
  const entry = hits.get(key) || { count: 0, firstAt: now };
  if (now - entry.firstAt > WINDOW_MS) {
    entry.count = 0;
    entry.firstAt = now;
  }
  entry.count += 1;
  hits.set(key, entry);
  return entry.count > (LIMITS[bucket] || 30);
}

/**
 * 處理 /api/* 請求。回傳 false 代表沒有對應的路由。
 */
export async function handleApi(req, res, url) {
  const { pathname } = url;
  const method = req.method;
  const seg = pathname.split('/').filter(Boolean); // ['api', ...]

  const requireAdmin = () => {
    if (!isAuthenticated(req)) {
      throw Object.assign(new Error('請先登入後台。'), { status: 401, expected: true });
    }
  };

  // ------------------------------------------------ 共用：表單欄位定義
  if (pathname === '/api/form-schema' && method === 'GET') {
    return sendJson(res, 200, {
      studentFields: STUDENT_FIELDS,
      registrationFields: REGISTRATION_FIELDS,
      privacyNotice: PRIVACY_NOTICE,
      courseNotes: COURSE_NOTES,
      lineUrl: LINE_URL,
      lineId: LINE_ID,
      ageMismatchNotice: AGE_MISMATCH_NOTICE,
      firstTimeNotice: FIRST_TIME_NOTICE,
      clashNotice: CLASH_NOTICE,
      today: todayInTaipei(),
    });
  }

  // ------------------------------------------------ 前台：行事曆
  if (pathname === '/api/calendar' && method === 'GET') {
    return sendJson(res, 200, await calendarMonth(url.searchParams.get('month')));
  }

  // ------------------------------------------------ 前台：前後測問卷
  if (seg[0] === 'api' && seg[1] === 'survey' && seg.length === 4 && method === 'GET') {
    return sendJson(res, 200, await surveyForm(decodeURIComponent(seg[2]), seg[3]));
  }

  if (seg[0] === 'api' && seg[1] === 'survey' && seg.length === 4 && method === 'POST') {
    if (lookupThrottled(clientIp(req))) {
      throw Object.assign(new Error('嘗試次數過多，請稍後再試。'), { status: 429, expected: true });
    }
    const body = await readJsonBody(req);
    const result = await submitSurvey({
      slugOrId: decodeURIComponent(seg[2]),
      phase: seg[3],
      name: body.name,
      birthDate: body.birthDate,
      answers: body.answers,
    });
    // 同名的少年不只一位時還沒送出，回 200 讓前台多問一次生日
    if (result.needsBirthDate) return sendJson(res, 200, result);
    return sendJson(res, 201, result);
  }

  // ------------------------------------------------ 前台：簽到
  if (pathname === '/api/checkin/sessions' && method === 'GET') {
    return sendJson(res, 200, await sessionsForCheckin(url.searchParams.get('date')));
  }

  // 這一堂現在簽到幾個人了。數字誰都看得到；名單只給登入過的工作人員，
  // 簽到的 QR 是印在現場的，誰都掃得到，不能把整份名單攤開
  if (pathname === '/api/checkin/status' && method === 'GET') {
    return sendJson(res, 200, await checkinStatus(url.searchParams.get('session'), {
      withNames: isAuthenticated(req),
    }));
  }

  if (pathname === '/api/checkin' && method === 'POST') {
    if (lookupThrottled(clientIp(req))) {
      throw Object.assign(new Error('嘗試次數過多，請稍後再試。'), { status: 429, expected: true });
    }
    const body = await readJsonBody(req);
    const result = await checkIn({
      sessionId: body.sessionId, name: body.name, birthDate: body.birthDate, method: 'qr',
    });
    // 同名的少年不只一位時還沒簽到成功，回 200 讓前台多問一次生日
    if (result.needsBirthDate) return sendJson(res, 200, result);
    return sendJson(res, 201, { ok: true, ...result });
  }

  // ------------------------------------------------ 前台：活動
  if (pathname === '/api/activities' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'all';
    const activities = await listActivities(scope);
    return sendJson(res, 200, { activities: activities.map(publicActivity) });
  }

  if (seg[0] === 'api' && seg[1] === 'activities' && seg.length === 3 && method === 'GET') {
    const activity = await findActivity(decodeURIComponent(seg[2]));
    if (!activity) throw notFound('找不到這個活動。');
    const sessions = await listSessions(activity.id);
    return sendJson(res, 200, {
      activity: publicActivity(activity),
      sessions: sessions.map((s) => ({
        id: s.id, date: s.date, startTime: s.startTime, endTime: s.endTime, title: s.title,
      })),
      sessionSummary: summariseSessions(sessions),
    });
  }

  // ------------------------------------------------ 前台：場地借用
  if (pathname === '/api/booking/schema' && method === 'GET') {
    const venues = await listVenues();
    return sendJson(res, 200, {
      // 前台能選的只有那五間：全館與烘焙教室不給外面的人借
      venues: venues
        .filter((v) => v.active !== false && !PUBLIC_ONLY_HIDDEN.includes(v.name))
        .map((v) => ({ id: v.id, name: v.name, note: v.note, capacity: v.capacity })),
      equipment: EQUIPMENT,
      activityTypes: ACTIVITY_TYPES,
      rules: RULES_TEXT,
      opening: OPENING_TEXT,
      underConstruction: UNDER_CONSTRUCTION,
      constructionNotice: CONSTRUCTION_NOTICE,
      today: todayInTaipei(),
    });
  }

  if (pathname === '/api/booking/calendar' && method === 'GET') {
    return sendJson(res, 200, await bookingCalendar({
      from: url.searchParams.get('from') || todayInTaipei(),
      to: url.searchParams.get('to') || todayInTaipei(),
    }));
  }

  if (pathname === '/api/booking' && method === 'POST') {
    if (lookupThrottled(clientIp(req), 'booking')) {
      throw Object.assign(new Error('送出次數過多，請稍後再試。'), { status: 429, expected: true });
    }
    const booking = await createBooking(await readJsonBody(req));
    return sendJson(res, 201, {
      ok: true,
      booking: {
        id: booking.id, venueName: booking.venueName, date: booking.date,
        startTime: booking.startTime, endTime: booking.endTime,
      },
    });
  }

  // 用電話查自己的預約（只回未來、還有效的）
  if (pathname === '/api/booking/mine' && method === 'POST') {
    if (lookupThrottled(clientIp(req), 'booking')) {
      throw Object.assign(new Error('查詢次數過多，請稍後再試。'), { status: 429, expected: true });
    }
    const body = await readJsonBody(req);
    return sendJson(res, 200, { bookings: await bookingsByPhone(body.phone) });
  }

  if (seg[0] === 'api' && seg[1] === 'booking' && seg[3] === 'cancel' && method === 'POST') {
    const body = await readJsonBody(req);
    return sendJson(res, 200, await cancelBooking(decodeURIComponent(seg[2]), {
      phone: body.phone, admin: isAuthenticated(req),
    }));
  }

  // ------------------------------------------------ 前台：老朋友快速報名查詢
  if (pathname === '/api/lookup' && method === 'POST') {
    if (lookupThrottled(clientIp(req))) {
      throw Object.assign(new Error('查詢次數過多，請稍後再試。'), { status: 429, expected: true });
    }
    const body = await readJsonBody(req);
    const { name, idNumber, birthDate } = body;
    if (!name || !idNumber || !birthDate) {
      throw badRequest('請輸入姓名、身分證字號與出生年月日。');
    }
    const student = await lookupStudent({ name, idNumber, birthDate });
    if (!student) {
      return sendJson(res, 200, {
        found: false,
        message: '查不到資料，可能是第一次報名，或三項資料有一項對不上。請改用完整報名表。',
      });
    }
    const activity = body.activitySlug ? await findActivity(body.activitySlug) : null;
    return sendJson(res, 200, {
      found: true,
      student,
      alreadyRegistered: activity ? await hasRegistered(activity.id, student.id) : false,
      // 老朋友快速報名：送出之前就先提醒他這幾天已經報了別的活動
      scheduleClashes: activity ? await clashesForStudent(student.id, activity) : [],
    });
  }

  // ------------------------------------------------ 前台：查自己報名過哪些活動
  //
  // 公開查詢，所以跟老朋友查詢共用同一個次數限制，
  // 避免有人拿身分證字號一組一組試。
  if (pathname === '/api/my-registrations' && method === 'POST') {
    if (lookupThrottled(clientIp(req))) {
      throw Object.assign(new Error('查詢次數過多，請稍後再試。'), { status: 429, expected: true });
    }
    const body = await readJsonBody(req);
    return sendJson(res, 200, await myRegistrations({
      name: body.name, idNumber: body.idNumber,
    }));
  }

  // ------------------------------------------------ 前台：送出報名
  if (seg[0] === 'api' && seg[1] === 'activities' && seg[3] === 'register'
      && seg.length === 4 && method === 'POST') {
    const activity = await findActivity(decodeURIComponent(seg[2]));
    if (!activity) throw notFound('找不到這個活動。');
    const body = await readJsonBody(req);
    const result = await register({
      activity,
      profile: body.profile,
      studentId: body.studentId,
      answers: body.answers,
    });
    return sendJson(res, 201, {
      ok: true,
      waitlisted: result.waitlisted,
      waitlistPosition: result.waitlistPosition,
      // 年齡不符仍然收件，只是要先講清楚錄取順序
      ageMismatch: result.ageMismatch,
      ageMismatchNotice: result.ageMismatch ? AGE_MISMATCH_NOTICE : '',
      // 同一天撞到別的活動：不擋，但要講
      scheduleClashes: result.scheduleClashes,
      message: result.waitlisted
        ? `這個活動已經額滿，你排在候補第 ${result.waitlistPosition} 位。`
          + '有人取消時，我們會照順序通知你，請加 LINE 保持聯絡。'
        : '報名成功！我們已收到你回覆的表單，報名後 2 週內公布，謝謝！',
      registrationId: result.registration.id,
    });
  }

  // ------------------------------------------------ 後台：登入
  if (pathname === '/api/admin/login' && method === 'POST') {
    const body = await readJsonBody(req);
    const result = await login(req, res, body.password);
    if (!result.ok) return sendJson(res, result.status, { error: result.message });
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/logout' && method === 'POST') {
    logout(res);
    return sendJson(res, 200, { ok: true });
  }

  if (pathname === '/api/admin/session' && method === 'GET') {
    return sendJson(res, 200, { authenticated: isAuthenticated(req) });
  }

  // ------------------------------------------------ 後台：以下全部需要登入
  if (pathname === '/api/admin/stats' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, await stats());
  }

  if (pathname === '/api/admin/activities' && method === 'GET') {
    requireAdmin();
    const scope = url.searchParams.get('scope') || 'all';
    // 後台要看得到封閉式團體，不然工作人員自己也找不到那些活動
    return sendJson(res, 200, {
      activities: await listActivities(scope, { includeUnlisted: true }),
    });
  }

  // 行事曆同步的設定狀態。只回報有沒有設、設了哪一組帳號，不會回傳私鑰
  if (pathname === '/api/admin/calendar/config' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, calendarConfig());
  }

  // 連線測試：真的去 Google 走一遍（含建一個測試事件再刪掉）
  if (pathname === '/api/admin/calendar/test' && method === 'POST') {
    requireAdmin();
    return sendJson(res, 200, await calendarCheck());
  }

  // 活動管理的「按月統計」：每個月有哪些活動、上了幾堂、簽到幾人次
  if (pathname === '/api/admin/activity-months' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, { months: await activityMonths() });
  }

  if (pathname === '/api/admin/activities' && method === 'POST') {
    requireAdmin();
    const body = await readJsonBody(req);
    return sendJson(res, 201, { activity: await createActivity(body) });
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities' && seg.length === 4) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { activity: await updateActivity(id, body) });
    }
    if (method === 'DELETE') {
      return sendJson(res, 200, await deleteActivity(id));
    }
    if (method === 'GET') {
      const activity = await findActivity(id);
      if (!activity) throw notFound('找不到這個活動。');
      return sendJson(res, 200, { activity });
    }
  }

  // 單一活動的報名名冊
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities'
      && seg[4] === 'registrations' && seg.length === 5 && method === 'GET') {
    requireAdmin();
    const activity = await findActivity(decodeURIComponent(seg[3]));
    if (!activity) throw notFound('找不到這個活動。');
    return sendJson(res, 200, { activity, roster: await buildRoster(activity) });
  }

  // 保險用的名冊：只有投保需要的欄位、只收正取
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities'
      && seg[4] === 'insurance.csv' && seg.length === 5 && method === 'GET') {
    requireAdmin();
    const activity = await findActivity(decodeURIComponent(seg[3]));
    if (!activity) throw notFound('找不到這個活動。');
    const filename = `${safeFilename(activity.title)}_保險名冊_${todayInTaipei()}.csv`;
    const stem = activity.slug === activity.eventDate
      ? activity.slug
      : `${activity.slug}-${activity.eventDate}`;
    const roster = await buildRoster(activity);
    return sendCsv(res, filename, `peiliyuan-${stem}-insurance.csv`, insuranceCsv(roster));
  }

  // 單一活動的名冊下載
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities'
      && seg[4] === 'export.csv' && seg.length === 5 && method === 'GET') {
    requireAdmin();
    const activity = await findActivity(decodeURIComponent(seg[3]));
    if (!activity) throw notFound('找不到這個活動。');
    const filename = `${safeFilename(activity.title)}_報名名冊_${todayInTaipei()}.csv`;
    // 中文活動名的 slug 本來就是活動日期，這時不要再重複接一次日期
    const stem = activity.slug === activity.eventDate
      ? activity.slug
      : `${activity.slug}-${activity.eventDate}`;
    const roster = await buildRoster(activity);
    return sendCsv(res, filename, `peiliyuan-${stem}-roster.csv`, rosterCsv(roster));
  }

  // 刪除某人的報名 / 加註記
  // 工作人員手動把候補改成正取
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'registrations'
      && seg[4] === 'promote' && seg.length === 5 && method === 'POST') {
    requireAdmin();
    return sendJson(res, 200, await promoteRegistration(decodeURIComponent(seg[3])));
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'registrations' && seg.length === 4) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'DELETE') return sendJson(res, 200, await deleteRegistration(id));
    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      // 同一支端點兩件事：勾不錄取、加註記
      if (body.rejected !== undefined) {
        return sendJson(res, 200, await setRegistrationRejected(id, body.rejected === true));
      }
      return sendJson(res, 200, await setRegistrationNote(id, body.note));
    }
  }

  // ------------------------------------------------ 後台：題庫
  if (pathname === '/api/admin/questions' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, {
      questions: await listQuestions(),
      typeLabels: QUESTION_TYPE_LABELS,
      scaleLabels: SCALE_LABELS,
    });
  }

  if (pathname === '/api/admin/questions' && method === 'POST') {
    requireAdmin();
    return sendJson(res, 201, { question: await createQuestion(await readJsonBody(req)) });
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'questions' && seg.length === 4) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'PATCH' || method === 'PUT') {
      return sendJson(res, 200, { question: await updateQuestion(id, await readJsonBody(req)) });
    }
    if (method === 'DELETE') return sendJson(res, 200, await deleteQuestion(id));
  }

  // 這個活動挑了哪幾題
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities'
      && seg[4] === 'questions' && seg.length === 5) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'GET') return sendJson(res, 200, { questions: await listActivityQuestions(id) });
    if (method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { questions: await setActivityQuestions(id, body.questions || []) });
    }
  }

  // 前後測結果
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities'
      && seg[4] === 'survey' && seg.length === 5 && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, await surveyResults(decodeURIComponent(seg[3])));
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities'
      && seg[4] === 'survey.csv' && seg.length === 5 && method === 'GET') {
    requireAdmin();
    const activity = await findActivity(decodeURIComponent(seg[3]));
    if (!activity) throw notFound('找不到這個活動。');
    const results = await surveyResults(activity.id);
    const filename = `${safeFilename(activity.title)}_前後測_${todayInTaipei()}.csv`;
    const stem = activity.slug === activity.eventDate
      ? activity.slug
      : `${activity.slug}-${activity.eventDate}`;
    return sendCsv(res, filename, `peiliyuan-${stem}-survey.csv`, surveyCsv(results));
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'survey-responses'
      && seg.length === 4 && method === 'DELETE') {
    requireAdmin();
    return sendJson(res, 200, await removeSurveyResponse(decodeURIComponent(seg[3])));
  }

  // ------------------------------------------------ 後台：場次
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities'
      && seg[4] === 'sessions' && seg.length === 5) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'GET') return sendJson(res, 200, { sessions: await listSessions(id) });
    if (method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { sessions: await replaceSessions(id, body.sessions || []) });
    }
  }

  // 活動的出席總覽（報名者 × 各場次）
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities'
      && seg[4] === 'attendance' && seg.length === 5 && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, await attendanceOverview(decodeURIComponent(seg[3])));
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'sessions' && seg.length === 4) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'DELETE') return sendJson(res, 200, await removeSession(id));
    if (method === 'GET') return sendJson(res, 200, await sessionAttendance(id));
  }

  // 工作人員代簽到
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'sessions'
      && seg[4] === 'checkin' && seg.length === 5 && method === 'POST') {
    requireAdmin();
    const body = await readJsonBody(req);
    const result = await checkIn({
      sessionId: decodeURIComponent(seg[3]),
      studentId: body.studentId,
      name: body.name, birthDate: body.birthDate, idNumber: body.idNumber, method: 'manual',
    });
    if (result.needsBirthDate) return sendJson(res, 200, result);
    return sendJson(res, 201, { ok: true, ...result });
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'attendances'
      && seg.length === 4 && method === 'DELETE') {
    requireAdmin();
    return sendJson(res, 200, await removeAttendance(decodeURIComponent(seg[3])));
  }

  // ------------------------------------------------ 後台：月報統計
  // 手動人次：跟別單位合辦、沒辦法逐一簽到的活動，由工作人員自己填
  if (pathname === '/api/admin/manual-counts' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, {
      manualCounts: await listManualCounts({
        month: url.searchParams.get('month'),
        programCategory: url.searchParams.get('programCategory'),
        serviceType: url.searchParams.get('serviceType'),
        subCategory: url.searchParams.get('subCategory'),
      }),
    });
  }

  if (pathname === '/api/admin/manual-counts' && method === 'POST') {
    requireAdmin();
    const body = await readJsonBody(req);
    /*
     * 一次補好幾場：body 給 { shared, rows }。
     * 像烘焙課這種一個月上好幾次的，共用的欄位只填一次。
     * 只給單筆的舊寫法照樣收。
     */
    if (Array.isArray(body.rows)) {
      return sendJson(res, 201, await createManualCounts(body.shared || {}, body.rows));
    }
    return sendJson(res, 201, { manualCount: await createManualCount(body) });
  }

  // ------------------------------------------------ 後台：月報的手填欄位
  if (pathname === '/api/admin/report-extras' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, await listReportExtras(url.searchParams.get('month')));
  }

  if (pathname === '/api/admin/report-extras' && method === 'PUT') {
    requireAdmin();
    const body = await readJsonBody(req);
    return sendJson(res, 200, await saveReportExtras(body.month, body.kind, body.rows));
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'manual-counts' && seg.length === 4) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'PATCH' || method === 'PUT') {
      return sendJson(res, 200, { manualCount: await updateManualCount(id, await readJsonBody(req)) });
    }
    if (method === 'DELETE') return sendJson(res, 200, await deleteManualCount(id));
  }

  // ------------------------------------------------ 後台：場地借用
  if (pathname === '/api/admin/venues' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, { venues: await listVenues() });
  }

  if (pathname === '/api/admin/venues' && method === 'POST') {
    requireAdmin();
    return sendJson(res, 201, { venue: await createVenue(await readJsonBody(req)) });
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'venues' && seg.length === 4) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'PATCH' || method === 'PUT') {
      return sendJson(res, 200, { venue: await updateVenue(id, await readJsonBody(req)) });
    }
    if (method === 'DELETE') return sendJson(res, 200, await deleteVenue(id));
  }

  if (pathname === '/api/admin/bookings' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, await listBookings({
      month: url.searchParams.get('month'),
      venueId: url.searchParams.get('venueId'),
      status: url.searchParams.get('status'),
      kind: url.searchParams.get('kind'),
    }));
  }

  // 社工在後台鎖場地：不受時數與人數限制
  if (pathname === '/api/admin/bookings' && method === 'POST') {
    requireAdmin();
    const booking = await createBooking(await readJsonBody(req), { staffMode: true });
    return sendJson(res, 201, { booking });
  }

  // 匯入舊的借用紀錄（上傳原本那張試算表）
  // 匯入時對不到的那幾筆，社工在畫面上確認之後按「清掉」會走到這裡
  if (pathname === '/api/admin/bookings/cleanup' && method === 'POST') {
    requireAdmin();
    const body = await readJsonBody(req);
    return sendJson(res, 200, await cleanupImportedBookings(body.ids));
  }

  if (pathname === '/api/admin/bookings/import' && method === 'POST') {
    requireAdmin();
    const body = await readJsonBody(req);
    const base64 = String(body.file || '').replace(/^data:[^,]*,/, '');
    if (!base64) throw badRequest('請選擇要匯入的檔案。');
    let rows;
    try {
      rows = readSheet(Buffer.from(base64, 'base64'));
    } catch (err) {
      throw badRequest(`這個檔案讀不出來：${err.message}`);
    }
    return sendJson(res, 200, await importBookings(rows, { dryRun: body.dryRun === true }));
  }

  // 閉館公告
  if (pathname === '/api/admin/closures' && method === 'POST') {
    requireAdmin();
    return sendJson(res, 201, await createClosure(await readJsonBody(req)));
  }

  if (pathname === '/api/admin/booking-stats' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, await bookingStats(url.searchParams.get('month')));
  }

  // 每日場地匯報：給排程呼叫（Vercel Cron／GitHub Actions），要帶密鑰
  if (pathname === '/api/cron/daily-booking-report' && (method === 'POST' || method === 'GET')) {
    const secret = (process.env.CRON_SECRET || '').trim();
    const given = (req.headers.authorization || '').replace(/^Bearer\s+/i, '')
      || url.searchParams.get('key') || '';
    if (!isAuthenticated(req) && (!secret || given !== secret)) {
      throw Object.assign(new Error('沒有權限。'), { status: 401, expected: true });
    }
    return sendJson(res, 200, await dailyBookingReport(url.searchParams.get('date') || undefined));
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'bookings' && seg.length === 4) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'PATCH' || method === 'PUT') {
      return sendJson(res, 200, { booking: await updateBooking(id, await readJsonBody(req)) });
    }
    if (method === 'DELETE') return sendJson(res, 200, await deleteBooking(id));
  }

  if (pathname === '/api/admin/reports' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, await monthlyReport({
      month: url.searchParams.get('month'),
      basis: url.searchParams.get('basis'),
      programCategory: url.searchParams.get('programCategory'),
      serviceType: url.searchParams.get('serviceType'),
      subCategory: url.searchParams.get('subCategory'),
    }));
  }

  if (pathname === '/api/admin/reports/export.csv' && method === 'GET') {
    requireAdmin();
    const report = await monthlyReport({
      month: url.searchParams.get('month'),
      basis: url.searchParams.get('basis'),
      programCategory: url.searchParams.get('programCategory'),
      serviceType: url.searchParams.get('serviceType'),
      subCategory: url.searchParams.get('subCategory'),
    });
    const label = report.month || '全部月份';
    return sendCsv(
      res,
      `培力園_月報統計_${label}.csv`,
      `peiliyuan-report-${report.month || 'all'}.csv`,
      reportCsv(report),
    );
  }

  /*
   * 社會局要的月報表（Excel）。
   *
   * 跟上面的 CSV 不一樣：CSV 是系統自己的統計，這一份是照社會局那張
   * 表的版面排好的 —— 場地設施使用與活動明細會自動填好，其他區塊留白。
   * 一次只給一個月，社工下載後貼進自己那個大檔當新分頁。
   */
  if (pathname === '/api/admin/reports/bureau.xlsx' && method === 'GET') {
    requireAdmin();
    const { buffer, filename } = await bureauMonthlySheet(url.searchParams.get('month'));
    return sendFile(res, {
      filename,
      asciiFallback: `peiliyuan-bureau-${url.searchParams.get('month')}.xlsx`,
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      body: buffer,
    });
  }

  // 簽到 QR 要編進去的正式網址。由後端決定，工作人員從哪個網址開後台都一樣。
  if (pathname === '/api/admin/site' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, { baseUrl: PUBLIC_BASE_URL });
  }

  // ------------------------------------------------ 後台：學生總表
  if (pathname === '/api/admin/students' && method === 'GET') {
    requireAdmin();
    const students = await searchStudents(url.searchParams.get('q') || '');
    return sendJson(res, 200, { students });
  }

  if (pathname === '/api/admin/students/export.csv' && method === 'GET') {
    requireAdmin();
    const students = await searchStudents(url.searchParams.get('q') || '');
    return sendCsv(
      res,
      `培力園_學生資料總表_${todayInTaipei()}.csv`,
      `peiliyuan-all-students-${todayInTaipei()}.csv`,
      studentsCsv(students),
    );
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'students' && seg.length === 4) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'DELETE') return sendJson(res, 200, await deleteStudent(id));
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { student: await updateStudent(id, body) });
    }
    if (method === 'GET') {
      const student = await findStudentById(id);
      if (!student) throw notFound('找不到這位學生。');
      return sendJson(res, 200, { student, history: await studentHistory(id) });
    }
  }

  return false;
}
