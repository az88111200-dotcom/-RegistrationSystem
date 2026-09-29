/**
 * 場地借用的規則。
 *
 * 這些規則原本寫在舊系統的網頁裡（使用者改一下網頁就繞得過去），
 * 搬過來之後一律在伺服器這邊判斷，前台只是先提醒，真正把關的是這裡。
 *
 * 規則本身照園方原本公告的辦法：
 *   週日、週一固定休館
 *   週二～週五 10:00-20:30、週六 10:00-18:30
 *   最早 10:30 開始；為了閉館作業，最晚借到閉館前 30 分鐘
 *   一般借用單次最多 3 小時；一樓練團室最少 3 人
 *   社工內部鎖場地不受時數與人數限制
 */

import { todayInTaipei } from './util.js';

/** 每天的開館與閉館時間。0=週日 … 6=週六。沒有的那幾天就是休館。 */
const HOURS = {
  2: { open: '10:00', close: '20:30' },
  3: { open: '10:00', close: '20:30' },
  4: { open: '10:00', close: '20:30' },
  5: { open: '10:00', close: '20:30' },
  6: { open: '10:00', close: '18:30' },
};

/** 借用最早可以從幾點開始（開館後半小時，讓工作人員先準備）。 */
const EARLIEST_START = '10:30';
/** 閉館前要留 30 分鐘做閉館作業，所以最晚只能借到這個時間。 */
const CLOSING_BUFFER_MIN = 30;
/** 一般借用單次上限。 */
const MAX_HOURS = 3;
/** 需要最少人數的空間（一個人佔著練團室太可惜）。 */
const MIN_PEOPLE = { 一樓練團室: 3 };

/** 全館：借了它等於整棟都被佔用，跟任何空間都互斥。 */
export const WHOLE_VENUE = '全館';

/** 借用表與行事曆上不顯示的空間（舊系統的做法，烘焙教室另外管理）。 */
export const HIDDEN_VENUES = ['三樓烘焙教室'];

/**
 * 前台「我要預約」不給選的空間。
 * 全館是整棟一起借，只有社工鎖場地與閉館公告會用到；
 * 烘焙教室由後台另外排。跟舊系統的下拉選單一致。
 */
export const PUBLIC_ONLY_HIDDEN = [...HIDDEN_VENUES, WHOLE_VENUE];

/** 借用表上的簡稱：照舊系統的寫法，帶 emoji 比較好認。 */
const SHORT_NAMES = {
  一樓練團室: '🎸 1F練團室',
  二樓舞蹈教室: '💃 2F舞蹈教室',
  二樓貓窩: '🐈 2F貓窩',
  二樓會議區: '💻 2F會議區',
  三樓文創空間: '🎨 3F文創空間',
  全館: '🏛 全館',
};
export function shortVenueName(name) {
  return SHORT_NAMES[name] || name;
}

/** 借用表上的空間順序，照園方原本的排法（練團室→舞蹈→貓窩→會議→文創）。 */
const ROOM_ORDER = ['一樓練團室', '二樓舞蹈教室', '二樓貓窩', '二樓會議區', '三樓文創空間', WHOLE_VENUE];
export function venueOrder(name) {
  const index = ROOM_ORDER.indexOf(name);
  return index === -1 ? 99 : index;
}

export const ACTIVITY_TYPES = [
  '學生社團活動', '舞蹈練習', '團體活動課程', '手工藝美編',
  '開會討論', '課業學習輔導', '其他',
];

/**
 * 各空間可以借的設備與數量上限。
 * 照園方原本表單上的品項，key 是空間名稱。
 */
export const EQUIPMENT = {
  一樓練團室: [
    ['木吉他', 3], ['電吉他', 1], ['木箱鼓', 6], ['麥克風', 2], ['電鋼琴', 1],
    ['電子爵士鼓', 1], ['烏克麗麗', 1], ['譜架', 3], ['吉他架', 2], ['導線', 3],
    ['麥克風架', 2], ['BLACKSTAR 吉他音箱', 1], ['LANEY貝斯音箱', 1],
    ['ROLAND鋼琴音箱', 1], ['NUX爵士鼓音箱', 1], ['直立式音響', 2],
  ],
  三樓文創空間: [['木吉他', 3], ['木箱鼓', 6], ['烏克麗麗', 1]],
  二樓會議區: [
    ['木吉他', 3], ['木箱鼓', 6], ['烏克麗麗', 1], ['會議桌', 6],
    ['會議椅', 37], ['鋼琴', 1], ['電鋼琴', 1], ['卡拉ok', 1],
  ],
  二樓貓窩: [['木吉他', 3], ['木箱鼓', 6], ['烏克麗麗', 1], ['卡拉ok', 1]],
};

export const RULES_TEXT = {
  apply: [
    ['先搶先贏', '場地借用採先搶先贏制，若有重複借用，以表單送出之日期為優先順序。'],
    ['預約確認', '請依指示填寫預約時間及場地，並於「查詢／取消」確認您的預約資訊。'],
    ['閉館作業', '為進行閉館作業，借用場地最晚可申請至閉館前 30 分鐘。'],
  ],
  use: [
    // 第三個值 'important'：前台放大、紅字粗體（最常被違反、也最難收拾的一條）
    ['飲食規範', '二樓貓窩、會議區、舞蹈教室及一樓練團室內禁止進食；飲料僅限可密封之瓶罐（如寶特瓶、附蓋水壺），以免傾倒潑灑、孳生蚊蟲。', 'important'],
    ['時數限制', '借用場地之團體一次限 3 小時，現場續借視情況一次可延長 1-2 小時。'],
    ['出席與遲到', '借用場地 30 分鐘內未入場達 1/2 人員則取消當次申請。若預約卻未如期抵達，超過 3 次，將暫停您使用本場館空間 1 個月。'],
    ['場地復原', '場地使用完畢後，請主動恢復場地整潔至借用前狀態。如達 3 次（含）未場復，中心有權拒絕借用。'],
    ['愛惜公物', '嚴禁破壞設備，如有損壞由借用團體照價賠償至恢復原狀。'],
    ['活動干擾', '為維護活動品質，空間的借用以不會干擾到本館辦理的活動為原則。'],
    ['中止借用', '若場地實際使用與申請內容不符，培力園有權利立即中止借用。'],
  ],
};

/** 送出前的同意勾選。前台照這句顯示，伺服器沒收到同意就不收。 */
export const RULES_AGREEMENT = '我已閱讀並同意遵守場地借用規範';

export const OPENING_TEXT = '週二－週五 10:00-20:30　·　週六 10:00-18:30　·　週日、週一固定休館';

/**
 * 正式對外開放的日子（台灣時間）：外面的人可以借「這一天以後」的時段。
 *
 * 限制的是「借哪一天」，不是「哪一天送出」—— 開放前就能先預約 10/1 以後的時段，
 * 10/1 以前的時段還是照原本的方式（舊表單或直接找社工）。
 * 每次請求都重新判斷，不是開機時算一次就定住（Vercel 的機器可能一路跑過午夜）。
 *
 * 環境變數 BOOKING_UNDER_CONSTRUCTION 可以蓋過日期：
 *   0 → 不看開放日，哪一天都能借（提早全開）
 *   1 → 整個關起來（臨時出狀況要暫停線上借用時用）
 *   沒設 → 照日期
 */
export const OPENS_ON = '2026-10-01';

/**
 * 前台現在能借的範圍。
 *   closed：整個暫停線上借用
 *   firstDate：最早能借哪一天（開放前是 OPENS_ON，之後就是今天）
 *   preOpening：還在開放日之前（公告要掛出來）
 */
export function publicWindow(today = todayInTaipei()) {
  const flag = String(process.env.BOOKING_UNDER_CONSTRUCTION ?? '').trim();
  if (flag === '1') return { closed: true, firstDate: '', preOpening: false };
  if (flag === '0' || today >= OPENS_ON) return { closed: false, firstDate: today, preOpening: false };
  return { closed: false, firstDate: OPENS_ON, preOpening: true };
}

const md = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
const dayBefore = (date) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

/** 前台借用頁最上面的公告。沒有要講的就回 null（正式開放後）。 */
export function publicNotice(today = todayInTaipei()) {
  const w = publicWindow(today);
  if (w.closed) {
    return {
      title: '⏸ 場地借用暫停線上登記',
      body: '這段期間要借場地，請直接找培力園社工。',
    };
  }
  if (w.preOpening) {
    return {
      title: `📅 ${md(w.firstDate)} 起的場地開放線上預約`,
      body: `現在就可以預約 ${md(w.firstDate)} 以後的時段。`
        + `${md(dayBefore(w.firstDate))} 以前要借場地，請照原本的方式（原本的借用表單或直接找社工）。`,
    };
  }
  return null;
}

/** 外面的人送出借用時，照日期擋。回傳錯誤訊息，沒問題回空字串。 */
export function publicWindowError(date, today = todayInTaipei()) {
  const w = publicWindow(today);
  if (w.closed) return '場地借用暫停線上登記，要借場地請直接找培力園社工。';
  if (date && date < w.firstDate) {
    return `線上預約從 ${md(w.firstDate)} 開始，${md(dayBefore(w.firstDate))} 以前的時段`
      + '請照原本的方式（原本的借用表單或直接找社工）。';
  }
  return '';
}

// ---------------------------------------------------------------- 時間

export function toMinutes(time) {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(time || '').trim());
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function toTime(minutes) {
  const h = Math.floor(minutes / 60);
  return `${String(h).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/**
 * 這一天開不開館、幾點到幾點。回傳 null 代表休館。
 *
 * 星期幾一定要用 getUTCDay() 算。
 * 這裡拿到的 date 本來就是台北的日曆日期（2026-11-10 就是台北的 11/10），
 * 所以把它當成 UTC 的那一天去取星期幾才會對。
 * 曾經寫成 new Date(`${date}T00:00:00+08:00`).getDay() —— getDay() 會照
 * 「伺服器的時區」換算，而 Vercel 跑在 UTC，換算後會倒退 8 小時變成前一天，
 * 結果整個開館表往前挪一天：週二借不到，週日反而借得到。
 */
export function hoursOn(date) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return HOURS[day] || null;
}

/** 這一天最晚可以借到幾點（閉館前 30 分鐘）。 */
export function latestEndOn(date) {
  const hours = hoursOn(date);
  return hours ? toTime(toMinutes(hours.close) - CLOSING_BUFFER_MIN) : '';
}

export function earliestStartOn(date) {
  const hours = hoursOn(date);
  if (!hours) return '';
  return toMinutes(EARLIEST_START) > toMinutes(hours.open) ? EARLIEST_START : hours.open;
}

/** 兩個時段有沒有重疊（碰在一起不算，10-12 跟 12-14 可以接著借）。 */
export function overlaps(aStart, aEnd, bStart, bEnd) {
  return toMinutes(aStart) < toMinutes(bEnd) && toMinutes(aEnd) > toMinutes(bStart);
}

/** 兩個空間會不會互相卡住（同一個空間，或其中一邊是「全館」）。 */
export function venueClashes(nameA, nameB) {
  return nameA === nameB || nameA === WHOLE_VENUE || nameB === WHOLE_VENUE;
}

/**
 * 檢查一筆借用合不合規則。回傳錯誤訊息的陣列，空陣列代表沒問題。
 *
 * staffMode＝社工內部鎖場地：不受時數、最少人數、最早最晚時間限制
 * （臨時要用、要用整天、要提早半小時佈置，都是實際會發生的事）。
 */
export function checkRules({
  date, startTime, endTime, venueName, headcount, today,
}, { staffMode = false } = {}) {
  const errors = [];
  if (!date) errors.push('請選日期。');
  if (!startTime || !endTime) errors.push('請填開始與結束時間。');
  if (errors.length) return errors;

  if (today && date < today) errors.push('不能預約已經過去的日期。');

  const start = toMinutes(startTime);
  const end = toMinutes(endTime);
  if (start < 0 || end < 0) return ['時間格式不正確。'];
  if (end <= start) errors.push('結束時間要晚於開始時間。');

  const hours = hoursOn(date);
  if (!hours) {
    errors.push('這一天休館（週日、週一固定休館），沒辦法借用。');
    return errors;
  }

  if (!staffMode) {
    const earliest = earliestStartOn(date);
    const latest = latestEndOn(date);
    if (start < toMinutes(earliest)) errors.push(`最早從 ${earliest} 開始借用。`);
    if (end > toMinutes(latest)) {
      errors.push(`這一天最晚借到 ${latest}（閉館前 30 分鐘要做閉館作業）。`);
    }
    if (end - start > MAX_HOURS * 60) errors.push(`單次借用最多 ${MAX_HOURS} 小時。`);
    const need = MIN_PEOPLE[venueName];
    if (need && Number(headcount) < need) {
      errors.push(`${venueName}最少需要 ${need} 人一起使用。`);
    }
  }
  return errors;
}
