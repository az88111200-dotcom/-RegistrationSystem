/**
 * 社會局月報表（Excel）。
 *
 * 版面照園方交出去的那份「月報表.xlsx」裡最新一張工作表（202608）重做，
 * 一次只產一個月、一張工作表 —— 社工下載後貼進自己那個大檔當新分頁。
 *
 * 系統會自動填好的：
 *   1. 場地設施使用  ← 借用紀錄 ＋ 培力園活動佔用的場次
 *   2. 活動明細      ← 每一堂課的簽到人數（含後台補登的），依性別與身分別拆開
 *   3. 參訪單位、外部資源連結、會議與教育訓練、FB／IG
 *      ← 後台「月報其他欄位」填的，沒填就留白
 *
 * 諮詢服務與總計表類系統裡沒有資料，只把框架跟標題做出來留白 ——
 * 寧可讓社工自己填，也不要編一個看起來很像真的數字出去。
 */

import { Sheet, STYLE } from './xlsx-write.js';

/*
 * 報表上的九個空間，順序照 202608 那張表。
 *
 * venue 是系統裡對得上的場地名稱；null 代表那間不開放線上登記
 * （交誼區、會談室、縫紉教室、卡啦OK區），數字留白給社工手填。
 */
export const VENUE_ROWS = [
  { label: '1F交誼區', venue: null },
  { label: '1F練團室', venue: '一樓練團室' },
  { label: '2F會議區', venue: '二樓會議區' },
  { label: '2F貓窩', venue: '二樓貓窩' },
  { label: '2F會談室', venue: null },
  { label: '2F縫紉教室', venue: null },
  { label: '2F舞蹈教室', venue: '二樓舞蹈教室' },
  { label: '2F卡啦OK區', venue: null },
  { label: '3F文創空間', venue: '三樓文創空間' },
  { label: '3F烘焙教室', venue: '三樓烘焙教室' },
];

/** 諮詢服務的項目，照原表列。系統沒有這些資料，整塊留白。 */
const CONSULT_ROWS = ['現場', '電話', '網路', '協談輔導', '資源連結', '資源開發', '其他'];

/** 總計表類的八張小表，照原表的標題。 */
const SUMMARY_BLOCKS = [
  '總計表類 (每月諮詢紀錄 / 總計)',
  '團體服務(兒少自我成長團體、支持性團體等)',
  '總計表類 (每月親職教育活動紀錄 / 總計)',
  '總計表類 (每月親子活動紀錄 / 總計)',
  '總計表類 (每月育樂活動紀錄 / 次數)',
  '總計表類 (社區服務)',
  '總計表類 (工作人員在職訓練紀錄 / 次數)',
  '總計表類 (其他福利服務)',
];

/** 2026-08 → 202608（工作表名稱照原檔的寫法）。 */
export function sheetName(month) {
  return String(month || '').replace('-', '');
}

/** 把場地使用的兩份資料合成報表要的每一列。 */
export function venueRows(usage, { includeActivities = true } = {}) {
  const pick = (list, name) => list.find((r) => r.venueName === name);
  return VENUE_ROWS.map((row) => {
    if (!row.venue) return { ...row, times: null, people: null, auto: false };
    const b = pick(usage.booked, row.venue);
    const a = includeActivities ? pick(usage.activity, row.venue) : null;
    return {
      ...row,
      auto: true,
      times: (b?.times || 0) + (a?.times || 0),
      people: (b?.people || 0) + (a?.people || 0),
      bookedTimes: b?.times || 0,
      activityTimes: a?.times || 0,
    };
  });
}

/**
 * 產生一個月的報表。
 *
 * 回傳 Buffer，直接當 .xlsx 下載。
 */
export function buildBureauSheet({ month, venues, sessions, extras = {}, generatedAt }) {
  const sheet = new Sheet(sheetName(month));
  sheet.widths({
    // B 是參訪與社區工作的日期欄，9.13 放不下 2026/11/05 會變成 ###
    A: 3, B: 11.5, C: 9.13, D: 9.13, E: 7, F: 7, G: 7, H: 7, I: 6, J: 6, K: 6, L: 3,
    // P+Q 是活動名稱，原本照舊檔的 14.63 會把長名字切掉
    // （例如「《開箱潛能｜72小時不可能任務》」），加寬到兩欄共 44 個字寬
    M: 13.75, N: 12.5, O: 10.38, P: 22, Q: 22, R: 7, S: 7, T: 7, U: 7, V: 10.38,
    W: 3, X: 3, Y: 8.88, Z: 8.88, AA: 8, AB: 8, AC: 8, AD: 8, AE: 8.88, AF: 8.88,
    AG: 8, AH: 8, AI: 8,
  });

  // ---------------------------------------------- 左上：諮詢服務（留白）
  sheet.text('B2', '諮詢服務', STYLE.blockTitle).merge('B2:E3');
  sheet.text('F2', '一般生', STYLE.head).merge('F2:G2');
  sheet.text('H2', '原住民', STYLE.head).merge('H2:I2');
  sheet.text('J2', '人次', STYLE.head);
  for (const [col, label] of [['F', '男'], ['G', '女'], ['H', '男'], ['I', '女'], ['J', '總計']]) {
    sheet.text(`${col}3`, label, STYLE.head);
  }
  CONSULT_ROWS.forEach((label, i) => {
    const row = 4 + i;
    sheet.text(`B${row}`, label, STYLE.label).merge(`B${row}:E${row}`);
    for (const col of ['F', 'G', 'H', 'I', 'J']) sheet.text(`${col}${row}`, '', STYLE.num);
  });
  const consultTotal = 4 + CONSULT_ROWS.length;
  sheet.text(`B${consultTotal}`, '總計', STYLE.total).merge(`B${consultTotal}:E${consultTotal}`);
  for (const col of ['F', 'G', 'H', 'I', 'J']) sheet.text(`${col}${consultTotal}`, '', STYLE.num);

  // ---------------------------------------------- 左中：場地設施使用（自動）
  const venueHead = 14;
  sheet.text(`B${venueHead}`, '場地設施使用', STYLE.blockTitle).merge(`B${venueHead}:D${venueHead}`);
  sheet.text(`E${venueHead}`, '次數', STYLE.head).merge(`E${venueHead}:F${venueHead}`);
  sheet.text(`G${venueHead}`, '人次', STYLE.head).merge(`G${venueHead}:H${venueHead}`);
  sheet.text(`I${venueHead}`, '男', STYLE.head);
  sheet.text(`J${venueHead}`, '女', STYLE.head);
  sheet.text(`K${venueHead}`, '其他', STYLE.head);

  let totalTimes = 0;
  let totalPeople = 0;
  venues.forEach((row, i) => {
    const r = venueHead + 1 + i;
    sheet.text(`B${r}`, row.label, STYLE.label).merge(`B${r}:D${r}`);
    sheet.num(`E${r}`, row.times).merge(`E${r}:F${r}`);
    sheet.num(`G${r}`, row.people).merge(`G${r}:H${r}`);
    // 借場地時沒有問性別，這三欄一直都是社工自己填的
    for (const col of ['I', 'J', 'K']) sheet.text(`${col}${r}`, '', STYLE.num);
    if (row.auto) {
      totalTimes += row.times;
      totalPeople += row.people;
    }
  });
  const venueTotal = venueHead + 1 + venues.length;
  sheet.text(`B${venueTotal}`, '總計', STYLE.total).merge(`B${venueTotal}:D${venueTotal}`);
  sheet.num(`E${venueTotal}`, totalTimes, STYLE.total).merge(`E${venueTotal}:F${venueTotal}`);
  sheet.num(`G${venueTotal}`, totalPeople, STYLE.total).merge(`G${venueTotal}:H${venueTotal}`);
  for (const col of ['I', 'J', 'K']) sheet.text(`${col}${venueTotal}`, '', STYLE.total);
  // 說明佔兩列，一列塞不下又會被切掉（合併的格子不會自己長高）
  sheet.text(`B${venueTotal + 1}`,
    '※ 空白的四間（1F交誼區、2F會談室、2F縫紉教室、2F卡啦OK區）沒有開放線上登記，請自行填寫。',
    STYLE.note).merge(`B${venueTotal + 1}:K${venueTotal + 1}`);
  sheet.text(`B${venueTotal + 2}`,
    '※ 男／女／其他三欄借用時沒有問，一律留白。',
    STYLE.note).merge(`B${venueTotal + 2}:K${venueTotal + 2}`);

  // ---------------------------------------------- 左下：參訪單位（留白）
  /*
   * 參訪單位／外部資源連結／會議與教育訓練 —— 後台「月報其他欄位」
   * 填了就帶進來，沒填就照原本的樣子留白給人手寫。
   * 不管有沒有資料都至少留幾列空的，社工臨時要手加不用自己畫格線。
   */
  const rowsFor = (kind, min) => {
    const list = extras[kind] || [];
    return Math.max(list.length + 2, min);
  };

  // 上面的兩列說明佔掉 +1、+2，所以參訪單位從 +4 開始
  const visitHead = venueTotal + 4;
  const visitRows = rowsFor('visit', 5);
  sheet.text(`B${visitHead}`, '日期', STYLE.head);
  sheet.text(`C${visitHead}`, '參訪單位', STYLE.head).merge(`C${visitHead}:H${visitHead}`);
  sheet.text(`I${visitHead}`, '人次', STYLE.head);
  sheet.text(`J${visitHead}`, '總計', STYLE.head);
  for (let i = 1; i <= visitRows; i += 1) {
    const r = visitHead + i;
    const e = (extras.visit || [])[i - 1];
    if (e) sheet.date(`B${r}`, e.date); else sheet.text(`B${r}`, '', STYLE.date);
    sheet.text(`C${r}`, e ? e.label : '', STYLE.text).merge(`C${r}:H${r}`);
    sheet.num(`I${r}`, e ? e.numbers[0] : null);
    sheet.text(`J${r}`, '', STYLE.num);
  }
  // 總計那一欄原本是社工自己加的，有資料就直接幫他加好
  if ((extras.visit || []).length) {
    sheet.num(`J${visitHead + 1}`, extras.visit.reduce((n, e) => n + e.numbers[0], 0));
  }

  const linkHead = visitHead + visitRows + 2;
  const linkRows = rowsFor('community', 5);
  sheet.text(`B${linkHead}`, '社區工作(外部資源連結或合作)', STYLE.blockTitle).merge(`B${linkHead}:J${linkHead}`);
  sheet.text(`B${linkHead + 1}`, '日期', STYLE.head);
  sheet.text(`C${linkHead + 1}`, '連結單位', STYLE.head).merge(`C${linkHead + 1}:G${linkHead + 1}`);
  sheet.text(`H${linkHead + 1}`, '人次', STYLE.head).merge(`H${linkHead + 1}:I${linkHead + 1}`);
  sheet.text(`J${linkHead + 1}`, '總計', STYLE.head);
  for (let i = 1; i <= linkRows; i += 1) {
    const r = linkHead + 1 + i;
    const e = (extras.community || [])[i - 1];
    if (e) sheet.date(`B${r}`, e.date); else sheet.text(`B${r}`, '', STYLE.date);
    sheet.text(`C${r}`, e ? e.label : '', STYLE.text).merge(`C${r}:G${r}`);
    sheet.num(`H${r}`, e ? e.numbers[0] : null).merge(`H${r}:I${r}`);
    sheet.text(`J${r}`, '', STYLE.num);
  }
  if ((extras.community || []).length) {
    sheet.num(`J${linkHead + 2}`, extras.community.reduce((n, e) => n + e.numbers[0], 0));
  }

  const meetHead = linkHead + linkRows + 3;
  const meetRows = rowsFor('meeting', 6);
  const meetCols = ['C', 'E', 'G', 'I'];
  sheet.text(`B${meetHead}`, '各項會議及教育訓練', STYLE.blockTitle).merge(`B${meetHead}:J${meetHead}`);
  sheet.text(`B${meetHead + 1}`, '同工', STYLE.head);
  ['個督', '團/外督', '行政/其他會議', '教育訓練/研習(討)會'].forEach((label, i) => {
    const col = meetCols[i];
    const next = String.fromCharCode(col.charCodeAt(0) + 1);
    sheet.text(`${col}${meetHead + 1}`, label, STYLE.head).merge(`${col}${meetHead + 1}:${next}${meetHead + 1}`);
  });
  for (let i = 1; i <= meetRows; i += 1) {
    const r = meetHead + 1 + i;
    const e = (extras.meeting || [])[i - 1];
    sheet.text(`B${r}`, e ? e.label : '', STYLE.label);
    meetCols.forEach((col, j) => {
      const next = String.fromCharCode(col.charCodeAt(0) + 1);
      sheet.num(`${col}${r}`, e ? e.numbers[j] : null).merge(`${col}${r}:${next}${r}`);
    });
  }
  // 原表最後有一列「總計」
  const meetTotal = meetHead + 1 + meetRows + 1;
  sheet.text(`B${meetTotal}`, '總計', STYLE.total);
  meetCols.forEach((col, j) => {
    const next = String.fromCharCode(col.charCodeAt(0) + 1);
    const list = extras.meeting || [];
    sheet.num(`${col}${meetTotal}`, list.length ? list.reduce((n, e) => n + e.numbers[j], 0) : null, STYLE.total)
      .merge(`${col}${meetTotal}:${next}${meetTotal}`);
  });

  // ---------------------------------------------- 右邊：活動明細（自動）
  sheet.text('M2', '服務類型', STYLE.head).merge('M2:M3');
  sheet.text('N2', '項目', STYLE.head).merge('N2:N3');
  sheet.text('O2', '日期', STYLE.head).merge('O2:O3');
  sheet.text('P2', '活動名稱', STYLE.head).merge('P2:Q3');
  sheet.text('R2', '一般生', STYLE.head).merge('R2:S2');
  sheet.text('T2', '原住民', STYLE.head).merge('T2:U2');
  sheet.text('V2', '總次數(不含親職講座)', STYLE.head).merge('V2:V3');
  for (const [col, label] of [['R', '男'], ['S', '女'], ['T', '男'], ['U', '女']]) {
    sheet.text(`${col}3`, label, STYLE.head);
  }

  // 手動補登、但沒拆男女與身分別的舊資料
  const needsSplit = (s) => s.manual
    && !s.generalMale && !s.generalFemale && !s.nativeMale && !s.nativeFemale;
  let blanks = 0;

  // 至少留 20 列空白，社工要手加幾場（例如親職講座）時不用自己畫格線
  const bodyRows = Math.max(sessions.length + 20, 40);
  const first = 4;
  for (let i = 0; i < bodyRows; i += 1) {
    const r = first + i;
    const s = sessions[i];
    sheet.text(`M${r}`, s ? s.serviceType : '', STYLE.text);
    sheet.text(`N${r}`, s ? s.subCategory : '', STYLE.text);
    if (s) sheet.date(`O${r}`, s.date); else sheet.text(`O${r}`, '', STYLE.date);
    sheet.text(`P${r}`, s ? s.title : '', STYLE.text).merge(`P${r}:Q${r}`);
    /*
     * 合併起來的儲存格，Excel 不會自己把列高撐開 —— 名字太長就只會看到
     * 被切掉的一行。所以這裡自己算要幾行：P 跟 Q 各 22 寬，合起來一行
     * 大約放得下 28 個中文字（實際排版量過的）。
     */
    if (s) {
      const lines = Math.ceil([...s.title].length / 28);
      if (lines > 1) sheet.height(r, Math.min(lines, 3) * 17 + 4);
    }
    /*
     * 早期的手動人次只填了總人次、沒拆男女與身分別。
     * 那種列的四格留白（不要寫 0）—— 寫 0 看起來像「這場沒人來」，
     * 會就這樣交出去；留白社工才看得出這裡還要自己填。
     */
    if (s && needsSplit(s)) {
      blanks += 1;
      for (const col of ['R', 'S', 'T', 'U']) sheet.text(`${col}${r}`, '', STYLE.num);
    } else {
      sheet.num(`R${r}`, s ? s.generalMale : null);
      sheet.num(`S${r}`, s ? s.generalFemale : null);
      sheet.num(`T${r}`, s ? s.nativeMale : null);
      sheet.num(`U${r}`, s ? s.nativeFemale : null);
    }
  }
  const last = first + bodyRows - 1;
  sheet.text(`V${first}`, '', STYLE.num).merge(`V${first}:V${last}`);

  const sessionTotal = last + 1;
  const sum = sessions.reduce((acc, s) => ({
    gm: acc.gm + s.generalMale,
    gf: acc.gf + s.generalFemale,
    nm: acc.nm + s.nativeMale,
    nf: acc.nf + s.nativeFemale,
  }), { gm: 0, gf: 0, nm: 0, nf: 0 });
  sheet.text(`M${sessionTotal}`, '總計', STYLE.total).merge(`M${sessionTotal}:Q${sessionTotal}`);
  sheet.num(`R${sessionTotal}`, sum.gm, STYLE.total);
  sheet.num(`S${sessionTotal}`, sum.gf, STYLE.total);
  sheet.num(`T${sessionTotal}`, sum.nm, STYLE.total);
  sheet.num(`U${sessionTotal}`, sum.nf, STYLE.total);
  sheet.num(`V${sessionTotal}`, sessions.length, STYLE.total);

  // ---------------------------------------------- 最右邊：總計表類（留白）
  SUMMARY_BLOCKS.forEach((label, i) => {
    const left = i % 2 === 0;
    const col = left ? 'Y' : 'AE';
    // 左邊那一格要併兩欄，不然「男女分類/總計」在 8.88 寬的欄位裡會折成三行，
    // 把整列撐高 —— 而那一列左邊就是場地表，跟著一起變高就對不齊了
    const pair = left ? 'Z' : 'AF';
    const cells = left ? ['AA', 'AB', 'AC'] : ['AG', 'AH', 'AI'];
    const wide = left ? 'AC' : 'AI';
    const head = 2 + Math.floor(i / 2) * 6;
    // 這裡不要設列高：這幾列左邊就是諮詢服務與場地表，右邊撐高左邊會跟著歪
    sheet.text(`${col}${head}`, label, STYLE.blockTitle).merge(`${col}${head}:${wide}${head}`);
    sheet.text(`${col}${head + 1}`, '男女分類/總計', STYLE.head).merge(`${col}${head + 1}:${pair}${head + 1}`);
    cells.forEach((c, j) => sheet.text(`${c}${head + 1}`, ['一般', '原住民', '小計'][j], STYLE.head));
    for (const [j, row] of ['男', '女', '總計'].entries()) {
      const r = head + 2 + j;
      sheet.text(`${col}${r}`, row, STYLE.label).merge(`${col}${r}:${pair}${r}`);
      for (const c of cells) sheet.text(`${c}${r}`, '', STYLE.num);
    }
  });

  // FB／IG 的數字也是後台填的（每個月一筆）
  const social = (head, title, labels, entry) => {
    sheet.text(`Y${head}`, title, STYLE.blockTitle).merge(`Y${head}:AC${head}`);
    labels.forEach((label, i) => {
      const r = head + 1 + i;
      sheet.text(`Y${r}`, label, STYLE.label).merge(`Y${r}:AA${r}`);
      sheet.num(`AB${r}`, entry ? entry.numbers[i] : null).merge(`AB${r}:AC${r}`);
    });
  };
  const socialHead = 2 + Math.ceil(SUMMARY_BLOCKS.length / 2) * 6;
  social(socialHead, '少年培力園FB粉專',
    ['貼文數', '瀏覽人次', '內容互動總數\n(按讚、留言、分享)'], (extras.fb || [])[0]);
  const igHead = socialHead + 5;
  social(igHead, '少年培力園IG',
    ['貼文數', '檢視次數', '觸及人數', '內容互動次數'], (extras.ig || [])[0]);

  // ---------------------------------------------- 頁尾：這份是誰、什麼時候產的
  const foot = Math.max(sessionTotal, meetTotal) + 2;
  sheet.text(`B${foot}`, `少年培力園　${month}　服務量統計（由報名系統產生：${generatedAt}）`, STYLE.note)
    .merge(`B${foot}:K${foot}`);
  // 說明拆成兩列 —— 一列塞不下，合併的格子不會自己長高，會被切掉
  sheet.text(`B${foot + 1}`,
    '※ 場地設施使用、活動明細、參訪單位、社區工作、會議與教育訓練、FB／IG 由系統帶入。',
    STYLE.note).merge(`B${foot + 1}:K${foot + 1}`);
  sheet.text(`B${foot + 2}`,
    '※ 活動人數以當天實際簽到為準。諮詢服務與右邊的總計表類系統沒有資料，請自行填寫。',
    STYLE.note).merge(`B${foot + 2}:K${foot + 2}`);
  if (blanks) {
    sheet.text(`B${foot + 3}`,
      `※ 活動明細裡有 ${blanks} 場是早期手動補登的，當初只填了總人次、沒有分男女與身分別，`
      + '所以那幾列的人數留白，請自行填上（之後用「補登活動人次」新增的都會直接帶入）。',
      STYLE.note).merge(`B${foot + 3}:K${foot + 3}`);
  }

  return sheet.build();
}
