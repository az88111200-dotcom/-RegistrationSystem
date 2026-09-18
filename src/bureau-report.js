/**
 * 社會局月報表（Excel）。
 *
 * 版面照園方交出去的那份「月報表.xlsx」裡最新一張工作表（202608）重做，
 * 一次只產一個月、一張工作表 —— 社工下載後貼進自己那個大檔當新分頁。
 *
 * 系統有資料的兩塊會自動填好：
 *   1. 場地設施使用  ← 借用紀錄 ＋ 培力園活動佔用的場次
 *   2. 活動明細      ← 每一堂課的簽到人數，依性別與身分別拆開
 *
 * 其他區塊（諮詢服務、參訪單位、外部資源連結、會議與教育訓練、
 * FB／IG 數據、總計表類）系統裡沒有這些資料，所以只把框架跟標題做出來
 * 留白 —— 寧可讓社工自己填，也不要編一個看起來很像真的數字出去。
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
export function buildBureauSheet({ month, venues, sessions, generatedAt }) {
  const sheet = new Sheet(sheetName(month));
  sheet.widths({
    A: 3, B: 9.13, C: 9.13, D: 9.13, E: 7, F: 7, G: 7, H: 7, I: 6, J: 6, K: 6, L: 3,
    M: 13.75, N: 12.5, O: 10.38, P: 14.63, Q: 14.63, R: 7, S: 7, T: 7, U: 7, V: 10.38,
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
  sheet.text(`B${venueTotal + 1}`,
    '※ 1F交誼區、2F會談室、2F縫紉教室、2F卡啦OK區沒有開放線上登記，數字空白請自行填寫；'
    + '男／女／其他三欄借用時沒有問，一律留白。',
    STYLE.note).merge(`B${venueTotal + 1}:K${venueTotal + 1}`);

  // ---------------------------------------------- 左下：參訪單位（留白）
  const visitHead = venueTotal + 3;
  sheet.text(`B${visitHead}`, '日期', STYLE.head);
  sheet.text(`C${visitHead}`, '參訪單位', STYLE.head).merge(`C${visitHead}:H${visitHead}`);
  sheet.text(`I${visitHead}`, '人次', STYLE.head);
  sheet.text(`J${visitHead}`, '總計', STYLE.head);
  for (let i = 1; i <= 5; i += 1) {
    const r = visitHead + i;
    sheet.text(`B${r}`, '', STYLE.date);
    sheet.text(`C${r}`, '', STYLE.text).merge(`C${r}:H${r}`);
    sheet.text(`I${r}`, '', STYLE.num);
    sheet.text(`J${r}`, '', STYLE.num);
  }

  const linkHead = visitHead + 7;
  sheet.text(`B${linkHead}`, '社區工作(外部資源連結或合作)', STYLE.blockTitle).merge(`B${linkHead}:J${linkHead}`);
  sheet.text(`B${linkHead + 1}`, '日期', STYLE.head);
  sheet.text(`C${linkHead + 1}`, '連結單位', STYLE.head).merge(`C${linkHead + 1}:G${linkHead + 1}`);
  sheet.text(`H${linkHead + 1}`, '人次', STYLE.head).merge(`H${linkHead + 1}:I${linkHead + 1}`);
  sheet.text(`J${linkHead + 1}`, '總計', STYLE.head);
  for (let i = 2; i <= 6; i += 1) {
    const r = linkHead + i;
    sheet.text(`B${r}`, '', STYLE.date);
    sheet.text(`C${r}`, '', STYLE.text).merge(`C${r}:G${r}`);
    sheet.text(`H${r}`, '', STYLE.num).merge(`H${r}:I${r}`);
    sheet.text(`J${r}`, '', STYLE.num);
  }

  const meetHead = linkHead + 8;
  sheet.text(`B${meetHead}`, '各項會議及教育訓練', STYLE.blockTitle).merge(`B${meetHead}:J${meetHead}`);
  sheet.text(`B${meetHead + 1}`, '同工', STYLE.head);
  for (const [col, label] of [['C', '個督'], ['E', '團/外督'], ['G', '行政/其他會議'], ['I', '教育訓練/研習(討)會']]) {
    const next = String.fromCharCode(col.charCodeAt(0) + 1);
    sheet.text(`${col}${meetHead + 1}`, label, STYLE.head).merge(`${col}${meetHead + 1}:${next}${meetHead + 1}`);
  }
  for (let i = 2; i <= 7; i += 1) {
    const r = meetHead + i;
    sheet.text(`B${r}`, '', STYLE.label);
    for (const col of ['C', 'E', 'G', 'I']) {
      const next = String.fromCharCode(col.charCodeAt(0) + 1);
      sheet.text(`${col}${r}`, '', STYLE.num).merge(`${col}${r}:${next}${r}`);
    }
  }

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
    sheet.num(`R${r}`, s ? s.generalMale : null);
    sheet.num(`S${r}`, s ? s.generalFemale : null);
    sheet.num(`T${r}`, s ? s.nativeMale : null);
    sheet.num(`U${r}`, s ? s.nativeFemale : null);
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
    const col = i % 2 === 0 ? 'Y' : 'AE';
    const wide = i % 2 === 0 ? 'AC' : 'AI';
    const head = 2 + Math.floor(i / 2) * 6;
    sheet.text(`${col}${head}`, label, STYLE.blockTitle).merge(`${col}${head}:${wide}${head}`);
    sheet.text(`${col}${head + 1}`, '男女分類/總計', STYLE.head);
    sheet.text(`${col === 'Y' ? 'AA' : 'AG'}${head + 1}`, '一般', STYLE.head);
    sheet.text(`${col === 'Y' ? 'AB' : 'AH'}${head + 1}`, '原住民', STYLE.head);
    sheet.text(`${col === 'Y' ? 'AC' : 'AI'}${head + 1}`, '小計', STYLE.head);
    for (const [j, row] of ['男', '女', '總計'].entries()) {
      const r = head + 2 + j;
      sheet.text(`${col}${r}`, row, STYLE.label);
      for (const c of col === 'Y' ? ['AA', 'AB', 'AC'] : ['AG', 'AH', 'AI']) {
        sheet.text(`${c}${r}`, '', STYLE.num);
      }
    }
  });

  const socialHead = 2 + Math.ceil(SUMMARY_BLOCKS.length / 2) * 6;
  sheet.text(`Y${socialHead}`, '少年培力園FB粉專', STYLE.blockTitle).merge(`Y${socialHead}:AC${socialHead}`);
  ['貼文數', '瀏覽人次', '內容互動總數\n(按讚、留言、分享)'].forEach((label, i) => {
    sheet.text(`Y${socialHead + 1 + i}`, label, STYLE.label).merge(`Y${socialHead + 1 + i}:AA${socialHead + 1 + i}`);
    sheet.text(`AB${socialHead + 1 + i}`, '', STYLE.num).merge(`AB${socialHead + 1 + i}:AC${socialHead + 1 + i}`);
  });
  const igHead = socialHead + 5;
  sheet.text(`Y${igHead}`, '少年培力園IG', STYLE.blockTitle).merge(`Y${igHead}:AC${igHead}`);
  ['貼文數', '檢視次數', '觸及人數', '內容互動次數'].forEach((label, i) => {
    sheet.text(`Y${igHead + 1 + i}`, label, STYLE.label).merge(`Y${igHead + 1 + i}:AA${igHead + 1 + i}`);
    sheet.text(`AB${igHead + 1 + i}`, '', STYLE.num).merge(`AB${igHead + 1 + i}:AC${igHead + 1 + i}`);
  });

  // ---------------------------------------------- 頁尾：這份是誰、什麼時候產的
  const foot = Math.max(sessionTotal, meetHead + 9) + 2;
  sheet.text(`B${foot}`, `少年培力園　${month}　服務量統計（由報名系統產生：${generatedAt}）`, STYLE.note)
    .merge(`B${foot}:K${foot}`);
  sheet.text(`B${foot + 1}`,
    '※ 場地設施使用與活動明細由系統自動帶入，其餘區塊請自行填寫。活動人數以當天實際簽到為準。',
    STYLE.note).merge(`B${foot + 1}:K${foot + 1}`);

  return sheet.build();
}
