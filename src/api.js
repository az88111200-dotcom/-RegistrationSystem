import { sendJson, sendCsv, readJsonBody, clientIp } from './http.js';
import { isAuthenticated, login, logout } from './auth.js';
import {
  STUDENT_FIELDS, REGISTRATION_FIELDS, PRIVACY_NOTICE, COURSE_NOTES,
} from './fields.js';
import { rosterCsv, studentsCsv, reportCsv, safeFilename } from './csv.js';
import { PUBLIC_BASE_URL } from './config.js';
import { todayInTaipei } from './util.js';
import {
  listActivities, findActivity, createActivity, updateActivity, deleteActivity,
  lookupStudent, register, deleteRegistration, setRegistrationNote, buildRoster,
  searchStudents, findStudentById, updateStudent, deleteStudent, hasRegistered,
  studentHistory, stats, monthlyReport, listSessions, replaceSessions, removeSession,
  sessionsForCheckin, checkIn, sessionAttendance, attendanceOverview, removeAttendance,
  summariseSessions, promoteRegistration, badRequest, notFound,
} from './model.js';

/** 前台看得到的活動資訊（不含後台備註）。 */
function publicActivity(a) {
  return {
    id: a.id, slug: a.slug, title: a.title, summary: a.summary, description: a.description,
    eventDate: a.eventDate, eventTime: a.eventTime, location: a.location,
    gatheringPlace: a.gatheringPlace, capacity: a.capacity, contact: a.contact,
    registrationDeadline: a.registrationDeadline, closed: a.closed,
    endDate: a.endDate, sessionCount: a.sessionCount,
    registrationCount: a.registrationCount, isPast: a.isPast, isOpen: a.isOpen,
    isFull: a.isFull, remainingSlots: a.remainingSlots,
    // 候補資訊要露到前台，讓大家看得到現在排了幾個人
    waitlistCount: a.waitlistCount, waitlistOpen: a.waitlistOpen,
    waitlistCapacity: a.waitlistCapacity, waitlistRemaining: a.waitlistRemaining,
    acceptingWaitlist: a.acceptingWaitlist,
  };
}

// ---- 老朋友查詢的次數限制，避免有人拿身分證字號暴力比對 ----
const lookupHits = new Map();
const LOOKUP_WINDOW_MS = 10 * 60 * 1000;
const LOOKUP_MAX = 30;

function lookupThrottled(ip) {
  const now = Date.now();
  const entry = lookupHits.get(ip) || { count: 0, firstAt: now };
  if (now - entry.firstAt > LOOKUP_WINDOW_MS) {
    entry.count = 0;
    entry.firstAt = now;
  }
  entry.count += 1;
  lookupHits.set(ip, entry);
  return entry.count > LOOKUP_MAX;
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
      today: todayInTaipei(),
    });
  }

  // ------------------------------------------------ 前台：簽到
  if (pathname === '/api/checkin/sessions' && method === 'GET') {
    return sendJson(res, 200, await sessionsForCheckin(url.searchParams.get('date')));
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
    });
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
    return sendJson(res, 200, { activities: await listActivities(scope) });
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
      return sendJson(res, 200, await setRegistrationNote(id, body.note));
    }
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
