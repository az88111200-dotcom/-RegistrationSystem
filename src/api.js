import {
  sendJson, sendCsv, readJsonBody, clientIp,
} from './http.js';
import { isAuthenticated, login, logout } from './auth.js';
import { STUDENT_FIELDS, REGISTRATION_FIELDS } from './fields.js';
import { rosterCsv, studentsCsv, safeFilename } from './csv.js';
import { todayInTaipei } from './util.js';
import {
  listActivities, findActivity, decorateActivity, createActivity, updateActivity,
  deleteActivity, lookupStudent, decorateStudent, register, deleteRegistration,
  setRegistrationNote, buildRoster, searchStudents, findStudentById, updateStudent,
  deleteStudent, hasRegistered, stats, badRequest, notFound,
} from './model.js';

/** 前台看得到的活動資訊（不含後台備註）。 */
function publicActivity(activity) {
  const a = decorateActivity(activity);
  return {
    id: a.id, slug: a.slug, title: a.title, summary: a.summary, description: a.description,
    eventDate: a.eventDate, eventTime: a.eventTime, location: a.location,
    gatheringPlace: a.gatheringPlace, capacity: a.capacity, contact: a.contact,
    registrationDeadline: a.registrationDeadline, closed: a.closed,
    registrationCount: a.registrationCount, isPast: a.isPast, isOpen: a.isOpen,
    isFull: a.isFull, remainingSlots: a.remainingSlots,
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
 * 處理 /api/* 請求。回傳 true 代表已處理。
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
      today: todayInTaipei(),
    });
  }

  // ------------------------------------------------ 前台：活動
  if (pathname === '/api/activities' && method === 'GET') {
    const scope = url.searchParams.get('scope') || 'all';
    return sendJson(res, 200, { activities: listActivities(scope).map(publicActivity) });
  }

  if (seg[0] === 'api' && seg[1] === 'activities' && seg.length === 3 && method === 'GET') {
    const activity = findActivity(decodeURIComponent(seg[2]));
    if (!activity) throw notFound('找不到這個活動。');
    return sendJson(res, 200, { activity: publicActivity(activity) });
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
    const student = lookupStudent({ name, idNumber, birthDate });
    if (!student) {
      return sendJson(res, 200, {
        found: false,
        message: '查不到資料，可能是第一次報名，或三項資料有一項對不上。請改用完整報名表。',
      });
    }
    const activitySlug = body.activitySlug;
    const activity = activitySlug ? findActivity(activitySlug) : null;
    return sendJson(res, 200, {
      found: true,
      student: decorateStudent(student),
      alreadyRegistered: activity ? hasRegistered(activity.id, student.id) : false,
    });
  }

  // ------------------------------------------------ 前台：送出報名
  if (seg[0] === 'api' && seg[1] === 'activities' && seg[3] === 'register'
      && seg.length === 4 && method === 'POST') {
    const activity = findActivity(decodeURIComponent(seg[2]));
    if (!activity) throw notFound('找不到這個活動。');
    const body = await readJsonBody(req);
    const result = register({
      activity,
      profile: body.profile,
      studentId: body.studentId,
      answers: body.answers,
    });
    return sendJson(res, 201, {
      ok: true,
      message: '報名成功！我們已收到你回覆的表單，報名後 2 週內公布，謝謝！',
      registrationId: result.registration.id,
      activity: publicActivity(result.activity),
    });
  }

  // ------------------------------------------------ 後台：登入
  if (pathname === '/api/admin/login' && method === 'POST') {
    const body = await readJsonBody(req);
    const result = login(req, res, body.password);
    if (!result.ok) {
      return sendJson(res, result.status, { error: result.message });
    }
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
    return sendJson(res, 200, stats());
  }

  if (pathname === '/api/admin/activities' && method === 'GET') {
    requireAdmin();
    const scope = url.searchParams.get('scope') || 'all';
    return sendJson(res, 200, { activities: listActivities(scope) });
  }

  if (pathname === '/api/admin/activities' && method === 'POST') {
    requireAdmin();
    const body = await readJsonBody(req);
    return sendJson(res, 201, { activity: createActivity(body) });
  }

  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities' && seg.length === 4) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { activity: updateActivity(id, body) });
    }
    if (method === 'DELETE') {
      return sendJson(res, 200, deleteActivity(id));
    }
    if (method === 'GET') {
      const activity = findActivity(id);
      if (!activity) throw notFound('找不到這個活動。');
      return sendJson(res, 200, { activity: decorateActivity(activity) });
    }
  }

  // 單一活動的報名名冊
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities'
      && seg[4] === 'registrations' && seg.length === 5 && method === 'GET') {
    requireAdmin();
    const activity = findActivity(decodeURIComponent(seg[3]));
    if (!activity) throw notFound('找不到這個活動。');
    return sendJson(res, 200, {
      activity: decorateActivity(activity),
      roster: buildRoster(activity),
    });
  }

  // 單一活動的名冊下載
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'activities'
      && seg[4] === 'export.csv' && seg.length === 5 && method === 'GET') {
    requireAdmin();
    const activity = findActivity(decodeURIComponent(seg[3]));
    if (!activity) throw notFound('找不到這個活動。');
    const filename = `${safeFilename(activity.title)}_報名名冊_${todayInTaipei()}.csv`;
    // 中文活動名的 slug 本來就是活動日期，這時不要再重複接一次日期
    const stem = activity.slug === activity.eventDate
      ? activity.slug
      : `${activity.slug}-${activity.eventDate}`;
    const fallback = `peiliyuan-${stem}-roster.csv`;
    return sendCsv(res, filename, fallback, rosterCsv(buildRoster(activity)));
  }

  // 刪除某人的報名 / 加註記
  if (seg[0] === 'api' && seg[1] === 'admin' && seg[2] === 'registrations' && seg.length === 4) {
    requireAdmin();
    const id = decodeURIComponent(seg[3]);
    if (method === 'DELETE') return sendJson(res, 200, deleteRegistration(id));
    if (method === 'PATCH') {
      const body = await readJsonBody(req);
      setRegistrationNote(id, body.note);
      return sendJson(res, 200, { ok: true });
    }
  }

  // ------------------------------------------------ 後台：學生總表
  if (pathname === '/api/admin/students' && method === 'GET') {
    requireAdmin();
    return sendJson(res, 200, { students: searchStudents(url.searchParams.get('q') || '') });
  }

  if (pathname === '/api/admin/students/export.csv' && method === 'GET') {
    requireAdmin();
    const students = searchStudents(url.searchParams.get('q') || '');
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
    if (method === 'DELETE') return sendJson(res, 200, deleteStudent(id));
    if (method === 'PATCH' || method === 'PUT') {
      const body = await readJsonBody(req);
      return sendJson(res, 200, { student: updateStudent(id, body) });
    }
    if (method === 'GET') {
      const student = findStudentById(id);
      if (!student) throw notFound('找不到這位學生。');
      const db = buildStudentHistory(student.id);
      return sendJson(res, 200, { student: decorateStudent(student), history: db });
    }
  }

  return false;
}

/** 某位學生報名過哪些活動，後台點名字時會展開。 */
function buildStudentHistory(studentId) {
  return listActivities('all')
    .map((activity) => {
      const roster = buildRoster(activity);
      const row = roster.find((r) => r.studentId === studentId);
      if (!row) return null;
      return {
        activityId: activity.id,
        activitySlug: activity.slug,
        activityTitle: activity.title,
        eventDate: activity.eventDate,
        isPast: activity.isPast,
        registrationId: row.registrationId,
        registeredAt: row.registeredAt,
      };
    })
    .filter(Boolean);
}
