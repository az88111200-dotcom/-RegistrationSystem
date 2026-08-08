import { EXPORT_COLUMNS, STUDENT_EXPORT_COLUMNS } from './fields.js';

/**
 * CSV 逃脫。開頭是 = + - @ 的值前面補一個單引號，
 * 避免 Excel 把資料當成公式執行（CSV injection）。
 */
function cell(value) {
  let s = Array.isArray(value) ? value.join('; ') : String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(columns, rows) {
  const lines = [columns.map((c) => cell(c.label)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => cell(row[c.key])).join(','));
  }
  return lines.join('\r\n');
}

/** 單一活動的報名名冊 CSV。 */
export function rosterCsv(roster) {
  const columns = [{ key: 'seq', label: '序號' }, ...EXPORT_COLUMNS];
  return toCsv(columns, roster);
}

/** 學生資料總表 CSV。 */
export function studentsCsv(students) {
  const columns = [{ key: 'seq', label: '序號' }, ...STUDENT_EXPORT_COLUMNS];
  return toCsv(columns, students.map((s, i) => ({ ...s, seq: i + 1 })));
}

/** 檔名裡不能有的字元換成底線。 */
export function safeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 100);
}
