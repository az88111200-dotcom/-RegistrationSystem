/**
 * 名單匯入：把 Excel／CSV 的學生名單讀成系統的學生欄位。
 *
 * 兩個地方用：
 *   - 後台活動名單的「📥 匯入名單」（跟學校合辦的活動，學校直接給名單，不用少年自己報名）
 *   - scripts/import-google-form.mjs（把舊的 Google 表單回覆匯進來）
 *
 * 表頭不用一字不差：比對時去掉空白與標點，而且「開頭一樣」就算（例：「年級（新學年為準）」對得到「年級」）。
 * 學校的名單常常最上面先有一兩列標題，所以表頭不一定在第一列，往下找幾列。
 */

import { readSheet, excelDate } from './xlsx.js';
import { NTPC_DISTRICTS } from './fields.js';
import { toHalfWidth } from './util.js';

// ---------------------------------------------------------------- CSV 解析

/** 支援引號內換行與雙引號跳脫的 CSV 解析。 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  const src = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => String(c).trim() !== ''));
}

/**
 * 上傳的檔案 → 一列一列的格子。
 * .xlsx 直接讀；其他當 CSV（Excel 另存的 CSV 有時是 Big5，UTF-8 讀起來一堆亂碼就改用 Big5 再讀一次）。
 */
export function rowsFromUpload(buffer, filename = '') {
  const isZip = buffer.length > 4 && buffer.readUInt32LE(0) === 0x04034b50;
  if (isZip || /\.xlsx$/i.test(filename)) return readSheet(buffer);
  let text = new TextDecoder('utf-8').decode(buffer);
  if (text.includes('�')) {
    try { text = new TextDecoder('big5').decode(buffer); } catch { /* 沒有 big5 就維持原樣 */ }
  }
  return parseCsv(text);
}

// ---------------------------------------------------------------- 欄位對應

/**
 * 表頭 → 系統欄位。同一個欄位可以有好幾種寫法（Google 表單的題目、學校名單常見的寫法）。
 * 順序有關係：「監護人身分證號」要比「身分證」先比對，不然會被當成少年的身分證。
 */
export const COLUMN_MAP = [
  [['使用者名稱', 'email', '電子郵件地址', '電子郵件', 'e-mail'], 'email'],
  [['監護人姓名保險用', '監護人姓名', '監護人〝姓名〞', '家長姓名', '法定代理人姓名'], 'guardianName'],
  [['監護人身分證號', '監護人身分證字號', '家長身分證字號', '家長身分證'], 'guardianIdNumber'],
  [['監護人出生年月日民國', '監護人出生年月日(民國)'], '__guardianBirthRoc'],
  [['監護人出生年月日', '家長出生年月日', '家長生日'], 'guardianBirthDate'],
  [['監護人國籍'], 'guardianNationality'],
  [['監護人與學生關係', '與學生關係', '關係'], 'guardianRelation'],
  [['監護人聯絡人電話', '監護人聯絡電話', '監護人電話', '家長電話', '家長手機', '緊急聯絡人電話'], 'guardianPhone'],
  [['少年姓名', '學生姓名', '姓名'], 'name'],
  [['少年性別', '生理性別', '性別'], 'gender'],
  [['身份證字號', '身分證字號', '身分證號', '身份證號', '身分證', '身份證', '統一證號'], 'idNumber'],
  [['身分別'], 'identityType'],
  [['特殊家庭狀況'], 'familyStatus'],
  [['出生年月日民國', '出生年月日(民國)'], '__birthRoc'],
  [['出生年月日', '出生日期', '生日'], 'birthDate'],
  [['就讀學校', '學校'], 'school'],
  [['年級新學年為準', '年級', '班級'], 'grade'],
  [['住家電話', '家裡電話', '市話'], 'homePhone'],
  [['少年手機', '學生手機', '手機'], 'mobile'],
  [['學籍居住區域只能新北市', '學籍/居住區域', '居住區域', '居住地區', '行政區', '區域'], 'district'],
  [['居住地址保險用請填詳細地址', '居住地址', '地址', '戶籍地址'], 'address'],
  [['從哪裡得知此活動'], 'source'],
  [['少年LINEID', '少年LINE ID', 'LINE ID', 'LINEID', 'LINE'], 'lineId'],
  [['請問您報名本活動的原因至少2項', '請問您報名本活動的原因'], 'reasons'],
  [['我一定會全程參與享受每個活動', '我一定會全程參與'], 'commitment'],
  [['時間戳記'], '__timestamp'],
];

export const simplify = (s) => String(s).replace(/[\s　()（）〝〞"'?？！!:：/／、,，.。*＊-]/g, '').toLowerCase();

export function buildHeaderIndex(header) {
  const index = {};
  header.forEach((title, position) => {
    const key = simplify(title);
    if (!key) return;
    for (const [aliases, field] of COLUMN_MAP) {
      if (index[field] !== undefined) continue;
      if (aliases.some((alias) => key === simplify(alias) || key.startsWith(simplify(alias)))) {
        index[field] = position;
        return;
      }
    }
  });
  return index;
}

/** 找表頭在第幾列：前 10 列裡第一個同時有「姓名」跟另一個認得的欄位的。 */
export function findHeader(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i += 1) {
    const index = buildHeaderIndex(rows[i] || []);
    if (index.name !== undefined && Object.keys(index).length >= 2) return { at: i, index };
  }
  return null;
}

// ---------------------------------------------------------------- 值的整理

/** Excel 的日期格子讀出來是序號（例：40210），轉成 YYYY-MM-DD；其他寫法原樣交給後面判斷。 */
export function dateCell(value) {
  const s = String(value ?? '').trim();
  if (/^\d{5}(\.\d+)?$/.test(s)) return excelDate(Number(s));
  // 民國 7 碼連寫（1000305）或西元 8 碼連寫（20110305）
  const roc7 = /^(\d{2,3})(\d{2})(\d{2})$/.exec(s);
  if (roc7 && s.length === 7) return `${roc7[1]}/${roc7[2]}/${roc7[3]}`;
  const ad8 = /^(\d{4})(\d{2})(\d{2})$/.exec(s);
  if (ad8) return `${ad8[1]}-${ad8[2]}-${ad8[3]}`;
  return s;
}

/** 男／男生／男性／M → 男；女同理。認不出來就原樣留著（表單的性別題有「其他」）。 */
export function genderCell(value) {
  const s = toHalfWidth(String(value ?? '')).trim();
  if (/^(男|男生|男性|m|male)$/i.test(s)) return '男';
  if (/^(女|女生|女性|f|female)$/i.test(s)) return '女';
  return s;
}

/** 泰山／泰山區／新北市泰山區 → 泰山區。不是新北市的區就回空字串（呼叫端會提醒）。 */
export function districtCell(value) {
  const s = toHalfWidth(String(value ?? '')).replace(/\s+/g, '').replace(/^(新北市|新北)/, '');
  if (!s) return '';
  if (NTPC_DISTRICTS.includes(s)) return s;
  const withSuffix = s.endsWith('區') ? s : `${s}區`;
  return NTPC_DISTRICTS.includes(withSuffix) ? withSuffix : '';
}

/** 一般／原住民／新住民。學校名單常常沒有這欄，空白就當一般（跟舊表單匯入一樣）。 */
export function identityCell(value) {
  const s = String(value ?? '').trim();
  if (!s) return '一般';
  if (/原住民|原民/.test(s)) return '原住民';
  if (/新住民|新移民/.test(s)) return '新住民';
  return s === '一般' ? '一般' : s;
}
