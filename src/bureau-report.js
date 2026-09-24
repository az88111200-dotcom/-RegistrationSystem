/**
 * 社會局月報表（Excel）。
 *
 * 版面照園方那份「新北市少年培力園每月服務統計 2026」重做，**座標對齊到格**：
 * 社工下載後整張貼進自己那個大檔當新分頁，要跟前幾個月完全疊得起來，
 * 所以每個區塊寫死在原本的列號上（諮詢在 3–12、場地在 15–25…），
 * 不隨資料多寡浮動。唯一會長的是活動明細，原表給 50 列（5–54），
 * 超過就往下長，總計列跟著走。
 *
 * 系統會自動填好的：
 *   1. 場地設施使用   ← 借用紀錄 ＋ 培力園活動佔用的場次
 *   2. 活動明細       ← 每一堂課的簽到人數（含後台補登的），依性別與身分別拆開
 *   3. 全項統計       ← 活動明細依服務類型分組的場次與人次
 *   4. 團體服務       ← 服務類型是「團體工作」的那些，男女 × 身分別
 *   5. 參訪單位、外部資源連結、會議與教育訓練、FB／IG
 *      ← 後台「月報其他欄位」填的，沒填就留白
 *
 * 諮詢服務系統裡沒有資料，留白給社工手填 —— 但底下的「每月諮詢紀錄」
 * 總計表跟「當月服務總人次」都寫成公式指過去，他填完那七列，
 * 其他格子會自己算出來，不用再手動加一次。
 *
 * 剩下六張總計表（親職教育、親子活動、育樂、社區服務、在職訓練、其他福利）
 * 系統對不到可靠的來源，只把框架做出來留白 ——
 * 寧可讓社工自己填，也不要編一個看起來很像真的數字出去。
 */

import { Sheet, STYLE } from './xlsx-write.js';

/*
 * 報表上的九個空間，順序照原表（列 16–24）。
 *
 * venue 是系統裡對得上的場地名稱；null 代表那間不開放線上登記
 * （交誼區、會談室、縫紉教室、卡啦OK區），數字留白給社工手填。
 *
 * 原表沒有「3F烘焙教室」這一列 —— 系統裡有這個場地，真的被借的時候
 * 會在頁尾提醒一句，不然數字會無聲無息地少掉。
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
];

/** 原表沒有這一列，但系統裡有這個場地。 */
export const OFF_FORM_VENUE = '三樓烘焙教室';

/** 諮詢服務的項目，照原表列（5–11）。系統沒有這些資料，整塊留白。 */
const CONSULT_ROWS = ['現場', '電話', '網路', '協談輔導', '資源連結', '資源開發', '其他'];

/** 全項統計的三種服務類型，照原表的順序。 */
const SERVICE_ROWS = ['團體工作', '方案服務', '社區工作'];

// ---------------------------------------------------------------- 固定座標
//
// 改動這裡等於改版面，要跟園方那份檔案對過再改。

const R = {
  consultHead: 3,
  consultFirst: 5,
  consultTotal: 12,
  venueHead: 15,
  venueFirst: 16,
  venueTotal: 25,
  visitHead: 28,
  visitFirst: 29,
  visitLast: 33,
  linkTitle: 35,
  linkHead: 36,
  linkFirst: 37,
  linkLast: 43,
  meetTitle: 46,
  meetHead: 47,
  meetFirst: 48,
  meetLast: 52,
  meetTotal: 53,
  actHead: 3,
  actFirst: 5,
  actMin: 54,          // 原表的活動明細畫到第 54 列，超過才往下長
  socialFb: 27,
  socialIg: 33,
  allStats: 28,
  grandLabel: 41,
  grandValue: 42,
};

/*
 * 2026-08-21 → 8/21。
 *
 * 參訪與社區工作的日期欄只有 9.38 寬，塞真正的日期格式會變成一整排 ###。
 * 原表那兩欄本來就是手寫的「8/21」，照他們的寫法。
 */
function shortDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  return m ? `${Number(m[2])}/${Number(m[3])}` : String(value || '');
}

/** 2026-09 → 11509（民國年 ＋ 月，照原檔的工作表名稱）。 */
export function sheetName(month) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  if (!m) return String(month || '').replace('-', '');
  return `${Number(m[1]) - 1911}${m[2]}`;
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

/** 原表放不下的場地（目前只有烘焙教室），有被借才回報。 */
export function offFormUsage(usage, { includeActivities = true } = {}) {
  const pick = (list) => list.find((r) => r.venueName === OFF_FORM_VENUE);
  const b = pick(usage.booked);
  const a = includeActivities ? pick(usage.activity) : null;
  const times = (b?.times || 0) + (a?.times || 0);
  const people = (b?.people || 0) + (a?.people || 0);
  return times || people ? { label: OFF_FORM_VENUE, times, people } : null;
}

/**
 * 產生一個月的報表。
 *
 * 回傳 Buffer，直接當 .xlsx 下載。
 */
export function buildBureauSheet({
  month, venues, sessions, extras = {}, offForm = null, generatedAt,
}) {
  const sheet = new Sheet(sheetName(month));
  // 欄寬照原表（openpyxl 讀出來的值），沒設的就是預設 8.43
  sheet.widths({
    A: 3.62, B: 9.38, C: 4.38, F: 5.12, I: 6.75, K: 5.88, L: 4.12,
    M: 17.75, N: 16.88, O: 12.5, P: 10.62, Q: 27.5, R: 5.88,
    V: 9.62, W: 5.12, X: 3.88, Y: 7.12, AA: 6.62, AG: 6.38, AJ: 4.62, AK: 8.88,
  });

  // ---------------------------------------------------------------- 大標
  // 原表的大標右邊接著寫年月，中間用空白隔開
  const ym = /^(\d{4})-(\d{2})$/.exec(String(month || ''));
  sheet.text('A1', '新北市少年培力園Pilot.Cafe 每月服務統計'
    + (ym ? `            ${ym[1]}年 ${ym[2]}月` : ''), STYLE.title).merge('A1:Z1');

  // ------------------------------------------------ 諮詢服務（留白，但串公式）
  const ch = R.consultHead;
  sheet.text(`B${ch}`, '諮詢服務', STYLE.blockTitle).merge(`B${ch}:E${ch + 1}`);
  sheet.text(`F${ch}`, '一般生', STYLE.head).merge(`F${ch}:G${ch}`);
  sheet.text(`H${ch}`, '原住民', STYLE.head).merge(`H${ch}:I${ch}`);
  sheet.text(`J${ch}`, '人次', STYLE.head);
  for (const [col, label] of [['F', '男'], ['G', '女'], ['H', '男'], ['I', '女'], ['J', '總計']]) {
    sheet.text(`${col}${ch + 1}`, label, STYLE.head);
  }
  /*
   * 網路、資源連結、資源開發、其他這四類不分男女與身分別 ——
   * 原表把那幾格塗成深灰（「這裡不用填」），只留最右邊的人次。
   * 照塗，社工才不會把四格都填了、總數變兩倍。
   */
  const noSplit = new Set(['網路', '資源連結', '資源開發', '其他']);
  const mutedLabels = new Set(['資源連結', '資源開發']);
  CONSULT_ROWS.forEach((label, i) => {
    const r = R.consultFirst + i;
    sheet.text(`B${r}`, label, mutedLabels.has(label) ? STYLE.mutedLabel : STYLE.label)
      .merge(`B${r}:E${r}`);
    if (label === '其他') {
      // 原表這一列是整個併成一格的
      sheet.text(`F${r}`, '', STYLE.blocked).merge(`F${r}:I${r}`);
    } else {
      for (const col of ['F', 'G', 'H', 'I']) {
        sheet.text(`${col}${r}`, '', noSplit.has(label) ? STYLE.blocked : STYLE.num);
      }
    }
    sheet.text(`J${r}`, '', STYLE.total);
  });
  const ct = R.consultTotal;
  sheet.text(`B${ct}`, '總計', STYLE.label).merge(`B${ct}:E${ct}`);
  for (const col of ['F', 'G', 'H', 'I']) {
    sheet.formula(`${col}${ct}`, `SUM(${col}${R.consultFirst}:${col}${ct - 1})`, STYLE.num);
  }
  sheet.formula(`J${ct}`, `SUM(J${R.consultFirst}:J${ct - 1})`, STYLE.total);

  // ------------------------------------------------------ 場地設施使用（自動）
  const vh = R.venueHead;
  sheet.text(`B${vh}`, '場地設施使用', STYLE.blockTitle).merge(`B${vh}:D${vh}`);
  sheet.text(`E${vh}`, '次數', STYLE.head).merge(`E${vh}:F${vh}`);
  sheet.text(`G${vh}`, '人次', STYLE.head).merge(`G${vh}:H${vh}`);
  sheet.text(`I${vh}`, '男', STYLE.head);
  sheet.text(`J${vh}`, '女', STYLE.head);
  sheet.text(`K${vh}`, '其他', STYLE.head);
  venues.forEach((row, i) => {
    const r = R.venueFirst + i;
    /*
     * 1F交誼區是開放空間，沒有「借幾次」這回事 —— 原表把次數那格塗黑，
     * 人次與男女那幾格塗米色（「這一列要自己數」）。照塗。
     */
    const lounge = i === 0;
    sheet.text(`B${r}`, row.label, STYLE.label).merge(`B${r}:D${r}`);
    if (lounge) sheet.text(`E${r}`, '', STYLE.blockedDark).merge(`E${r}:F${r}`);
    else sheet.num(`E${r}`, row.times).merge(`E${r}:F${r}`);
    sheet.num(`G${r}`, row.people, lounge ? STYLE.cream : STYLE.num).merge(`G${r}:H${r}`);
    // 借場地時沒有問性別，這三欄一直都是社工自己填的
    for (const col of ['I', 'J', 'K']) {
      sheet.text(`${col}${r}`, '', lounge ? STYLE.cream : STYLE.num);
    }
  });
  const vt = R.venueTotal;
  sheet.text(`B${vt}`, '總計', STYLE.label).merge(`B${vt}:D${vt}`);
  /*
   * 次數從第二列（1F練團室）開始加 —— 交誼區是開放空間，只算人次不算次數，
   * 原表的公式就是這樣寫的（SUM(E17:F24) / SUM(G16:H24)），照抄。
   */
  sheet.formula(`E${vt}`, `SUM(E${R.venueFirst + 1}:F${vt - 1})`, STYLE.num).merge(`E${vt}:F${vt}`);
  sheet.formula(`G${vt}`, `SUM(G${R.venueFirst}:H${vt - 1})`, STYLE.num).merge(`G${vt}:H${vt}`);
  for (const col of ['I', 'J', 'K']) {
    sheet.formula(`${col}${vt}`, `SUM(${col}${R.venueFirst}:${col}${vt - 1})`, STYLE.num);
  }
  // 原表在總計底下還留一列空的（社工偶爾會自己加一間），照留
  sheet.text(`B${vt + 1}`, '', STYLE.label).merge(`B${vt + 1}:D${vt + 1}`);
  sheet.text(`E${vt + 1}`, '', STYLE.num).merge(`E${vt + 1}:F${vt + 1}`);
  sheet.text(`G${vt + 1}`, '', STYLE.num).merge(`G${vt + 1}:H${vt + 1}`);
  for (const col of ['I', 'J', 'K']) sheet.text(`${col}${vt + 1}`, '', STYLE.num);

  // ------------------------------------------------------------ 參訪單位
  const vsh = R.visitHead;
  sheet.text(`B${vsh}`, '日期', STYLE.head);
  sheet.text(`C${vsh}`, '參訪單位', STYLE.head).merge(`C${vsh}:H${vsh}`);
  sheet.text(`I${vsh}`, '人次', STYLE.head);
  sheet.text(`J${vsh}`, '總計', STYLE.head);
  for (let r = R.visitFirst; r <= R.visitLast; r += 1) {
    const e = (extras.visit || [])[r - R.visitFirst];
    sheet.text(`B${r}`, e ? shortDate(e.date) : '', STYLE.label);
    sheet.text(`C${r}`, e ? e.label : '', STYLE.text).merge(`C${r}:H${r}`);
    sheet.num(`I${r}`, e ? e.numbers[0] : null);
  }
  // 總計那一欄原表是整塊合併起來的一格
  sheet.formula(`J${R.visitFirst}`, `SUM(I${R.visitFirst}:I${R.visitLast})`)
    .merge(`J${R.visitFirst}:J${R.visitLast}`);
  // 原表右邊還留一欄空的備註格
  sheet.text(`K${R.visitFirst}`, '', STYLE.num).merge(`K${R.visitFirst}:K${R.visitLast}`);

  // -------------------------------------------- 社區工作（外部資源連結或合作）
  sheet.text(`B${R.linkTitle}`, '社區工作(外部資源連結或合作)', STYLE.blockTitle)
    .merge(`B${R.linkTitle}:J${R.linkTitle}`);
  const lh = R.linkHead;
  sheet.text(`B${lh}`, '日期', STYLE.head);
  sheet.text(`C${lh}`, '連結單位', STYLE.head).merge(`C${lh}:G${lh}`);
  sheet.text(`H${lh}`, '人次', STYLE.head).merge(`H${lh}:I${lh}`);
  sheet.text(`J${lh}`, '總計', STYLE.head);
  for (let r = R.linkFirst; r <= R.linkLast; r += 1) {
    const e = (extras.community || [])[r - R.linkFirst];
    sheet.text(`B${r}`, e ? shortDate(e.date) : '', STYLE.label);
    sheet.text(`C${r}`, e ? e.label : '', STYLE.text).merge(`C${r}:G${r}`);
    sheet.num(`H${r}`, e ? e.numbers[0] : null).merge(`H${r}:I${r}`);
  }
  sheet.formula(`J${R.linkFirst}`, `SUM(H${R.linkFirst}:I${R.linkLast})`)
    .merge(`J${R.linkFirst}:J${R.linkLast}`);
  sheet.text(`K${R.linkFirst}`, '', STYLE.num).merge(`K${R.linkFirst}:K${R.linkLast - 1}`);

  // ------------------------------------------------------ 各項會議及教育訓練
  sheet.text(`B${R.meetTitle}`, '各項會議及教育訓練', STYLE.blockTitle)
    .merge(`B${R.meetTitle}:J${R.meetTitle}`);
  const mh = R.meetHead;
  const meetCols = ['C', 'E', 'G', 'I'];
  const nextCol = (col) => String.fromCharCode(col.charCodeAt(0) + 1);
  sheet.text(`B${mh}`, '同工', STYLE.head);
  ['個督', '團/外督', '行政/其他會議', '教育訓練/研習(討)會'].forEach((label, i) => {
    const col = meetCols[i];
    sheet.text(`${col}${mh}`, label, STYLE.head).merge(`${col}${mh}:${nextCol(col)}${mh}`);
  });
  for (let r = R.meetFirst; r <= R.meetLast; r += 1) {
    const e = (extras.meeting || [])[r - R.meetFirst];
    sheet.text(`B${r}`, e ? e.label : '', STYLE.label);
    meetCols.forEach((col, j) => {
      sheet.num(`${col}${r}`, e ? e.numbers[j] : null).merge(`${col}${r}:${nextCol(col)}${r}`);
    });
  }
  sheet.text(`B${R.meetTotal}`, '總計', STYLE.head);
  meetCols.forEach((col) => {
    sheet.formula(`${col}${R.meetTotal}`, `SUM(${col}${R.meetFirst}:${col}${R.meetLast})`, STYLE.num)
      .merge(`${col}${R.meetTotal}:${nextCol(col)}${R.meetTotal}`);
  });

  // ------------------------------------------------------------ 活動明細（自動）
  const ah = R.actHead;
  // 原表這兩格是鮮黃的、其他表頭是金黃的，照抄
  sheet.text(`M${ah}`, '服務類型', STYLE.blockTitle).merge(`M${ah}:M${ah + 1}`);
  sheet.text(`N${ah}`, '項目', STYLE.blockTitle).merge(`N${ah}:N${ah + 1}`);
  sheet.text(`O${ah}`, '日期', STYLE.head).merge(`O${ah}:O${ah + 1}`);
  sheet.text(`P${ah}`, '活動名稱', STYLE.head).merge(`P${ah}:Q${ah + 1}`);
  sheet.text(`R${ah}`, '一般生', STYLE.head).merge(`R${ah}:S${ah}`);
  sheet.text(`T${ah}`, '原住民', STYLE.head).merge(`T${ah}:U${ah}`);
  sheet.text(`V${ah}`, '總次數(不含親職講座)', STYLE.head).merge(`V${ah}:V${ah + 1}`);
  for (const [col, label] of [['R', '男'], ['S', '女'], ['T', '男'], ['U', '女']]) {
    sheet.text(`${col}${ah + 1}`, label, STYLE.head);
  }

  // 早期手動補登、沒拆男女與身分別的舊資料
  const needsSplit = (s) => s.manual
    && !s.generalMale && !s.generalFemale && !s.nativeMale && !s.nativeFemale;
  let blanks = 0;

  // 原表畫到第 54 列，場次更多就往下長
  const actLast = Math.max(R.actMin, R.actFirst + sessions.length - 1);
  for (let r = R.actFirst; r <= actLast; r += 1) {
    const s = sessions[r - R.actFirst];
    sheet.text(`M${r}`, s ? s.serviceType : '', STYLE.text);
    sheet.text(`N${r}`, s ? s.subCategory : '', STYLE.text);
    if (s) sheet.date(`O${r}`, s.date); else sheet.text(`O${r}`, '', STYLE.date);
    sheet.text(`P${r}`, s ? s.title : '', STYLE.text).merge(`P${r}:Q${r}`);
    /*
     * 合併起來的儲存格，Excel 不會自己把列高撐開 —— 名字太長就只會看到
     * 被切掉的一行。P 跟 Q 合起來約 38 個字寬，自己算要幾行。
     */
    if (s) {
      const lines = Math.ceil([...s.title].length / 38);
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
  // 原表的 V 欄是整塊合併成一格的「總次數」
  sheet.num(`V${R.actFirst}`, sessions.length).merge(`V${R.actFirst}:V${actLast}`);

  const at = actLast + 1;
  sheet.text(`M${at}`, '總計', STYLE.total).merge(`M${at}:Q${at}`);
  for (const col of ['R', 'S', 'T', 'U']) {
    sheet.formula(`${col}${at}`, `SUM(${col}${R.actFirst}:${col}${actLast})`, STYLE.num);
  }
  sheet.formula(`V${at}`, `SUM(R${at}:U${at})`, STYLE.total);

  // ------------------------------------------------------ 右邊：總計表類
  /*
   * 八張小表，左右各四張，每張六列高。
   * fill 給得出來的才填，給不出來的留白 —— 這幾張表系統對不到可靠的來源，
   * 編一個看起來很像真的數字出去比留白危險得多。
   */
  const summaryBlock = (col, head, {
    title, headLabel = '男女分類/總計', lastLabel, lastMerged, values,
  }) => {
    const pair = col === 'Y' ? 'Z' : 'AF';
    const cells = col === 'Y' ? ['AA', 'AB', 'AC'] : ['AG', 'AH', 'AI'];
    // 這幾張小表的標題原表沒有底色，只是粗體字
    sheet.text(`${col}${head}`, title, STYLE.plainTitle);
    // 表頭那句話原表不是統一的（育樂與在職訓練寫「次數總計」），照抄
    sheet.text(`${col}${head + 1}`, headLabel, STYLE.green)
      .merge(`${col}${head + 1}:${pair}${head + 1}`);
    cells.forEach((c, j) => sheet.text(`${c}${head + 1}`, ['一般', '原住民', '小計'][j], STYLE.blockTitle));
    ['男', '女', lastLabel].forEach((label, j) => {
      const r = head + 2 + j;
      // 最後一列（總計／次數）原表是金黃的，男女那兩列是鮮黃的
      const last = j === 2;
      sheet.text(`${col}${r}`, label, last ? STYLE.head : STYLE.yellowLabel)
        .merge(`${col}${r}:${pair}${r}`);
      // 「次數」那一列只有一個數字，原表把三格併成一格
      if (label === '次數' && lastMerged) {
        sheet.num(`${cells[0]}${r}`, values ? values.count : null, STYLE.head)
          .merge(`${cells[0]}${r}:${cells[2]}${r}`);
        return;
      }
      cells.forEach((c, k) => {
        const style = last ? STYLE.head : STYLE.num;
        if (!values) { sheet.text(`${c}${r}`, '', style); return; }
        if (k === 2) sheet.formula(`${c}${r}`, `${cells[0]}${r}+${cells[1]}${r}`, style);
        else sheet.num(`${c}${r}`, j === 0 ? values.male[k] : values.female[k], style);
      });
    });
  };

  /*
   * 每月諮詢紀錄：來源就是左上角那塊諮詢服務的總計列。
   * 寫成公式指過去，社工填完那七列這裡會自己算好，不用再手加一次。
   */
  const consultRefs = {
    male: [`F${ct}`, `H${ct}`],
    female: [`G${ct}`, `I${ct}`],
  };
  sheet.text('Y3', '總計表類  (每月諮詢紀錄 / 總計)', STYLE.plainTitle);
  sheet.text('Y4', '男女分類/總計', STYLE.green).merge('Y4:Z4');
  ['AA', 'AB', 'AC'].forEach((c, j) => sheet.text(`${c}4`, ['一般', '原住民', '小計'][j], STYLE.blockTitle));
  ['男', '女', '總計'].forEach((label, j) => {
    const r = 5 + j;
    const last = j === 2;
    const style = last ? STYLE.head : STYLE.num;
    sheet.text(`Y${r}`, label, last ? STYLE.head : STYLE.yellowLabel).merge(`Y${r}:Z${r}`);
    ['AA', 'AB'].forEach((c, k) => {
      if (last) sheet.formula(`${c}${r}`, `${c}5+${c}6`, style);
      else sheet.formula(`${c}${r}`, j === 0 ? consultRefs.male[k] : consultRefs.female[k], style);
    });
    sheet.formula(`AC${r}`, `AA${r}+AB${r}`, style);
  });

  /*
   * 團體服務：就是活動明細裡服務類型為「團體工作」的那些，
   * 男女與身分別都算得出來，次數就是場次。
   */
  const group = sessions.filter((s) => s.serviceType === '團體工作');
  const groupValues = {
    male: [
      group.reduce((n, s) => n + s.generalMale, 0),
      group.reduce((n, s) => n + s.nativeMale, 0),
    ],
    female: [
      group.reduce((n, s) => n + s.generalFemale, 0),
      group.reduce((n, s) => n + s.nativeFemale, 0),
    ],
    count: group.length,
  };
  summaryBlock('AE', 3, {
    title: '團體服務(兒少自我成長團體、支持性團體等)',
    lastLabel: '次數', lastMerged: true, values: groupValues,
  });


  for (const [col, head, title, lastLabel, lastMerged, headLabel] of [
    ['Y', 9, '總計表類  (每月親職教育活動紀錄 / 總計)', '總計', false, '男女分類/總計'],
    ['AE', 9, '總計表類  (每月親子活動紀錄 / 總計)', '總計', false, '男女分類/總計'],
    ['Y', 15, '總計表類  (每月育樂活動紀錄 / 次數)', '次數', true, '男女分類/次數總計'],
    ['AE', 15, '總計表類  (社區服務)', '次數', true, '男女分類/總計'],
    ['Y', 21, '總計表類  (工作人員在職訓練紀錄  / 次數)', '次數', true, '男女分類/次數總計'],
    ['AE', 21, '總計表類  (其他福利服務)', '總計', false, '男女分類/總計'],
  ]) {
    summaryBlock(col, head, {
      title, headLabel, lastLabel, lastMerged, values: null,
    });
  }

  // FB／IG 的數字是後台填的（每個月一筆）
  const social = (head, title, labels, entry, tallLast) => {
    sheet.text(`Y${head}`, title, STYLE.plainTitle);
    labels.forEach((label, i) => {
      const r = head + 1 + i;
      // 最後一列的標題有兩行，原表把它併成兩列高
      const span = tallLast && i === labels.length - 1 ? r + 1 : r;
      sheet.text(`Y${r}`, label, STYLE.yellowLabel).merge(`Y${r}:AA${span}`);
      sheet.num(`AB${r}`, entry ? entry.numbers[i] : null).merge(`AB${r}:AD${span}`);
    });
  };
  social(R.socialFb, '少年培力園FB粉專',
    ['貼文數', '瀏覽人次', '內容互動總數\n(按讚、留言、分享)'], (extras.fb || [])[0], true);
  social(R.socialIg, '少年培力園IG',
    ['貼文數', '瀏覽次數', '觸及人數', '內容互動次數'], (extras.ig || [])[0], false);

  // ------------------------------------------------------------ 全項統計（自動）
  const sh = R.allStats;
  sheet.text(`AF${sh}`, '全項統計', STYLE.green).merge(`AF${sh}:AG${sh}`);
  sheet.text(`AH${sh}`, '場次', STYLE.blockTitle);
  sheet.text(`AI${sh}`, '人次', STYLE.blockTitle);
  SERVICE_ROWS.forEach((type, i) => {
    const r = sh + 1 + i;
    const list = sessions.filter((s) => s.serviceType === type);
    sheet.text(`AF${r}`, type, STYLE.yellowLabel).merge(`AF${r}:AG${r}`);
    sheet.num(`AH${r}`, list.length);
    sheet.num(`AI${r}`, list.reduce((n, s) => n
      + s.generalMale + s.generalFemale + s.nativeMale + s.nativeFemale, 0));
  });
  const st = sh + 1 + SERVICE_ROWS.length;
  sheet.text(`AF${st}`, '總計', STYLE.head).merge(`AF${st}:AG${st}`);
  sheet.formula(`AH${st}`, `SUM(AH${sh + 1}:AH${st - 1})`, STYLE.head);
  sheet.formula(`AI${st}`, `SUM(AI${sh + 1}:AI${st - 1})`, STYLE.head);

  // -------------------------------------------------------- 當月服務 總人次
  sheet.text(`Y${R.grandLabel}`, '當月服務 總人次', STYLE.head).merge(`Y${R.grandLabel}:Z${R.grandLabel}`);
  // 公式照原表：諮詢 ＋ 場地 ＋ 社區工作 ＋ 活動明細
  sheet.formula(`Y${R.grandValue}`, `J${ct}+G${vt}+J${R.linkFirst}+V${at}`, STYLE.num)
    .merge(`Y${R.grandValue}:Z${R.grandValue + 2}`);

  // ------------------------------------------ 頁尾：這份是誰、什麼時候產的
  const foot = Math.max(at, R.meetTotal) + 2;
  const notes = [
    `少年培力園　${month}　服務量統計（由報名系統產生：${generatedAt}）`,
    '※ 場地設施使用、活動明細、全項統計、團體服務、參訪單位、社區工作、會議與教育訓練、FB／IG 由系統帶入。',
    '※ 活動人數以當天實際簽到為準。場地的男／女／其他三欄借用時沒有問，一律留白。',
    '※ 空白的四間（1F交誼區、2F會談室、2F縫紉教室、2F卡啦OK區）沒有開放線上登記，請自行填寫。',
    '※ 諮詢服務請自行填寫；填完之後「每月諮詢紀錄」與「當月服務總人次」會自己算出來。',
    '※ 其餘六張總計表（親職教育、親子活動、育樂、社區服務、在職訓練、其他福利）系統沒有資料，請自行填寫。',
  ];
  if (offForm) {
    notes.push(`※ 這個月「${offForm.label}」有 ${offForm.times} 次／${offForm.people} 人次，`
      + '但這張表沒有這一列，沒有算進場地設施使用的總計，請自行斟酌。');
  }
  if (blanks) {
    notes.push(`※ 活動明細裡有 ${blanks} 場是早期手動補登的，當初只填了總人次、沒有分男女與身分別，`
      + '所以那幾列的人數留白，請自行填上（之後用「補登活動人次」新增的都會直接帶入）。');
  }
  notes.forEach((text, i) => {
    sheet.text(`B${foot + i}`, text, STYLE.note).merge(`B${foot + i}:K${foot + i}`);
  });

  return sheet.build();
}
