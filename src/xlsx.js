/**
 * 極簡的 .xlsx 讀取器。
 *
 * 匯入舊資料時，社工手上拿到的就是 Excel 檔 —— 要他們先另存成 CSV
 * 是多一道會出錯的手續（編碼、分隔符號、日期格式都可能跑掉），
 * 所以這裡直接讀 .xlsx。
 *
 * xlsx 其實是一個 zip，裡面放 XML。Node 內建 zlib 就能解壓，
 * 我們只要兩個檔案：sharedStrings.xml（文字）與第一張工作表。
 * 為了維持「只靠 pg 一個相依套件」，zip 與 XML 都自己拆。
 */

import { inflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------- zip

/** 從 zip 檔裡把需要的檔案解出來（回傳 Map<檔名, Buffer>）。 */
function unzip(buffer) {
  // 先找檔案尾端的中央目錄（End of Central Directory，簽章 PK\x05\x06）
  let eocd = -1;
  for (let i = buffer.length - 22; i >= 0 && i > buffer.length - 66000; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('這不是有效的 Excel 檔（找不到 zip 結構）。');

  const count = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const files = new Map();

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) break;
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const name = buffer.toString('utf8', offset + 46, offset + 46 + nameLength);

    // 真正的資料在本地檔頭後面，名稱與額外欄位的長度要以本地檔頭為準
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const start = localOffset + 30 + localNameLength + localExtraLength;
    const raw = buffer.subarray(start, start + compressedSize);
    files.set(name, method === 0 ? raw : inflateRawSync(raw));

    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

// ---------------------------------------------------------------- XML

const unescapeXml = (text) => text
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
  .replace(/&amp;/g, '&');

/** 把 <t>…</t> 的內容接起來（一格可能被拆成好幾段）。 */
function textOf(xml) {
  const parts = [...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1]));
  return parts.join('');
}

function sharedStrings(files) {
  const xml = files.get('xl/sharedStrings.xml');
  if (!xml) return [];
  return [...xml.toString('utf8').matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
}

/** A→0、B→1、AA→26 */
function columnIndex(ref) {
  const letters = /^([A-Z]+)/.exec(ref);
  if (!letters) return 0;
  let index = 0;
  for (const ch of letters[1]) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * 讀第一張工作表，回傳二維陣列（每一列是字串陣列）。
 *
 * 日期與時間在 Excel 裡是數字（1900-01-01 起算的天數，時間是一天的幾分之幾），
 * 這裡一律原樣回傳字串，要怎麼解讀交給匯入的程式決定 ——
 * 同一欄可能有人打字、有人用日期格式，猜錯不如讓上層處理。
 */
export function readSheet(buffer) {
  const files = unzip(buffer);
  const strings = sharedStrings(files);
  const sheetName = [...files.keys()].find((n) => /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  if (!sheetName) throw new Error('這個 Excel 檔裡找不到工作表。');
  const xml = files.get(sheetName).toString('utf8');

  const rows = [];
  for (const rowMatch of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells = [];
    for (const cellMatch of rowMatch[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = /r="([A-Z]+\d+)"/.exec(attrs);
      const index = ref ? columnIndex(ref[1]) : cells.length;
      const type = /t="([^"]+)"/.exec(attrs)?.[1] || 'n';

      let value = '';
      if (type === 'inlineStr') {
        value = textOf(body);
      } else if (type === 's') {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = v ? (strings[Number(v[1])] ?? '') : '';
      } else {
        const v = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = v ? unescapeXml(v[1]) : '';
      }
      cells[index] = value;
    }
    // 中間沒有值的欄位補空字串，讓每一列都能用固定的索引取用
    for (let i = 0; i < cells.length; i += 1) if (cells[i] === undefined) cells[i] = '';
    rows.push(cells);
  }
  return rows;
}

// ------------------------------------------------- Excel 的日期與時間

/**
 * Excel 的日期序號 → YYYY-MM-DD。
 *
 * 序號 1 是 1900-01-01，但 Excel 沿用了 Lotus 1-2-3 的錯誤（把 1900 當閏年），
 * 所以實務上的基準點取 1899-12-30 才會對得起來。
 */
export function excelDate(serial) {
  const days = Math.floor(Number(serial));
  if (!Number.isFinite(days) || days <= 0) return '';
  const ms = Date.UTC(1899, 11, 30) + days * 86400000;
  return new Date(ms).toISOString().slice(0, 10);
}

/** Excel 的時間（一天的幾分之幾）→ HH:MM。 */
export function excelTime(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '';
  const fraction = n - Math.floor(n);
  // 四捨五入到分鐘：0.4375 剛好是 10:30，但有些格子會差在小數末位
  const minutes = Math.round(fraction * 24 * 60);
  const h = Math.floor(minutes / 60) % 24;
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Excel 的時間戳記序號 → 「YYYY-MM-DD HH:MM:SS」（系統其他地方都用這個格式）。 */
export function excelDateTime(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n <= 0) return '';
  const date = excelDate(n);
  if (!date) return '';
  const seconds = Math.round((n - Math.floor(n)) * 86400);
  const h = Math.floor(seconds / 3600) % 24;
  const m = Math.floor(seconds / 60) % 60;
  const s = seconds % 60;
  return `${date} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
