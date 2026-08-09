import { randomUUID } from 'node:crypto';

export const newId = () => randomUUID();

/** 台北時間（UTC+8），系統所有「今天」的判斷都以台灣時間為準。 */
const TZ_OFFSET_MS = 8 * 60 * 60 * 1000;

/** 回傳台灣時間的今天，格式 YYYY-MM-DD。 */
export function todayInTaipei() {
  return new Date(Date.now() + TZ_OFFSET_MS).toISOString().slice(0, 10);
}

/** 回傳台灣時間的現在，格式 YYYY-MM-DD HH:mm:ss。 */
export function nowInTaipei() {
  return new Date(Date.now() + TZ_OFFSET_MS)
    .toISOString().slice(0, 19).replace('T', ' ');
}

/** 西元 YYYY-MM-DD → 民國 YY/MM/DD（例：2005-02-16 → 94/02/16）。 */
export function toRocDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '').trim());
  if (!m) return '';
  const year = Number(m[1]) - 1911;
  if (year <= 0) return '';
  return `${year}/${m[2]}/${m[3]}`;
}

/** 民國 YY/MM/DD → 西元 YYYY-MM-DD。接受 94/10/2、094-10-02 等寫法。 */
export function fromRocDate(roc) {
  const m = /^(\d{2,3})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})$/.exec(String(roc || '').trim());
  if (!m) return '';
  const year = Number(m[1]) + 1911;
  const month = String(Number(m[2])).padStart(2, '0');
  const day = String(Number(m[3])).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 把使用者輸入的生日整理成 YYYY-MM-DD。
 * 同時接受西元（2008-08-18、2008/8/18）與民國（97/8/18）。
 */
export function normalizeBirthDate(input) {
  const raw = String(input || '').trim();
  if (!raw) return '';
  const iso = /^(\d{4})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{1,2})$/.exec(raw);
  if (iso) {
    return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`;
  }
  return fromRocDate(raw);
}

/** 計算某個基準日（預設今天）時的實歲年齡。 */
export function ageOn(birthDate, onDate = todayInTaipei()) {
  const b = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(birthDate || ''));
  const o = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(onDate || ''));
  if (!b || !o) return '';
  let age = Number(o[1]) - Number(b[1]);
  if (Number(o[2]) < Number(b[2]) || (o[2] === b[2] && Number(o[3]) < Number(b[3]))) age -= 1;
  return age >= 0 ? age : '';
}

/** 依照表單的年齡選項，把數字年齡換成級距文字。 */
export function ageBucket(age) {
  if (age === '' || age === null || age === undefined) return '';
  if (age <= 11) return '11歲以下';
  if (age >= 19) return '19歲以上';
  return String(age);
}

/** 身分證/居留證號正規化：去空白、轉大寫。 */
export function normalizeIdNumber(input) {
  return String(input || '').replace(/[\s\-　]/g, '').toUpperCase();
}

/**
 * 身分證/居留證號格式檢查。
 * 允許國民身分證（A123456789）與統一證號（AB12345678、A812345678）。
 * 只檢查格式不驗算檢查碼，避免擋掉新式居留證。
 */
export function isValidIdNumber(input) {
  const id = normalizeIdNumber(input);
  return /^[A-Z][0-9]{9}$/.test(id) || /^[A-Z][A-D][0-9]{8}$/.test(id);
}

/** 電話正規化：全形轉半形、去除空白。 */
export function normalizePhone(input) {
  return String(input || '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[（）]/g, (c) => (c === '（' ? '(' : ')'))
    .replace(/[\s　]/g, '')
    .trim();
}

/**
 * 全形英數字轉半形，使用者常從手機輸入法帶進全形字。
 *
 * 只轉數字與英文字母，**不動全形標點**。中文本來就該用「，」「！」「（）」，
 * 全部轉成半形會讓報名原因、學校名稱這種中文欄位變成半形逗號配全形句號的混雜。
 * 電話需要的括號轉換由 normalizePhone 自己處理。
 */
export function toHalfWidth(input) {
  return String(input || '')
    .replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ');
}

/**
 * 把標題轉成網址用的 slug。
 * 中文標題轉不出英文網址，就改用活動日期（例：/activity/2026-08-14），
 * 這樣分享到 LINE 的連結才不會變成一長串 %E5%B0%91 亂碼。
 */
export function slugify(title, fallback = '') {
  const base = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  if (base.length >= 3) return base;
  const dateBase = String(fallback || '').trim().replace(/[^0-9-]/g, '');
  return dateBase || `activity-${Math.random().toString(36).slice(2, 8)}`;
}

/** 陣列或字串統一成陣列（複選題用）。 */
export function toArray(value) {
  if (Array.isArray(value)) return value.filter((v) => String(v).trim() !== '');
  const s = String(value ?? '').trim();
  if (!s) return [];
  return s.split(/[;；,，]/).map((v) => v.trim()).filter(Boolean);
}
