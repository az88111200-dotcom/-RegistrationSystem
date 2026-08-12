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
  const columns = [
    { key: 'seq', label: '序號' },
    { key: 'statusLabel', label: '狀態' },
    ...EXPORT_COLUMNS,
  ];
  // 匯出的名單要看得出誰是正取、誰是候補第幾位
  return toCsv(columns, roster.map((r) => ({
    ...r,
    statusLabel: r.waitlisted ? `候補 ${r.seq}` : '正取',
  })));
}

/** 學生資料總表 CSV。 */
export function studentsCsv(students) {
  const columns = [{ key: 'seq', label: '序號' }, ...STUDENT_EXPORT_COLUMNS];
  return toCsv(columns, students.map((s, i) => ({ ...s, seq: i + 1 })));
}

/**
 * 月報統計 CSV：三張分佈表接在一起，直接貼進政府的表格。
 */
export function reportCsv(report) {
  const lines = [];
  const push = (...cells) => lines.push(cells.map(cell).join(','));

  const basisLabel = {
    attendance: '依出席月份 - 實際簽到人次',
    event: '依活動舉辦月份 - 實際報名人次',
  }[report.basis] || report.basis;
  const isAttendance = report.basis === 'attendance';

  push('少年培力園 月報統計');
  push('統計月份', report.month || '全部');
  push('統計基準', basisLabel);
  push('方案分類', report.filter.programCategory || '全部');
  push('服務類型', report.filter.serviceType || '全部');
  push('細分類', report.filter.subCategory || '全部');
  push('');
  push('活動數', report.totals.activities);
  if (isAttendance) push('課程場次', report.totals.sessions);
  push(isAttendance ? '實際簽到人次' : '實際報名人次', report.totals.registrations);
  push('實際人數（去重）', report.totals.people);

  for (const [title, rows] of [
    ['居住地區人次', report.byDistrict],
    ['年齡人次', report.byAge],
    ['身分別人次', report.byIdentity],
  ]) {
    push('');
    push(title);
    push('項目', '人次');
    for (const row of rows) push(row.key, row.count);
    push('小計', rows.reduce((sum, r) => sum + Number(r.count), 0));
  }

  push('');
  push('本期活動明細');
  push('活動日期', '活動名稱', '方案分類', '服務類型', '細分類', '報名人次');
  for (const a of report.activities) {
    push(a.eventDate, a.title, a.programCategory, a.serviceType, a.subCategory, a.registrationCount);
  }

  return lines.join('\r\n');
}

/** 檔名裡不能有的字元換成底線。 */
export function safeFilename(name) {
  return String(name).replace(/[\\/:*?"<>|\r\n]+/g, '_').slice(0, 100);
}
