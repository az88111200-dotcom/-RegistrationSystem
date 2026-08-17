import { EXPORT_COLUMNS, STUDENT_EXPORT_COLUMNS, INSURANCE_COLUMNS } from './fields.js';

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

/**
 * 保險用的名冊 CSV。
 *
 * 只收正取 —— 保險是保實際會來的人，候補還沒確定要不要來，
 * 保了也是白保。有人遞補上來之後重新下載一次就好。
 * 序號重新編號，交出去的名單才不會中間跳號。
 */
export function insuranceCsv(roster) {
  const confirmed = roster.filter((r) => !r.waitlisted);
  return toCsv(INSURANCE_COLUMNS, confirmed.map((r, i) => ({ ...r, seq: i + 1 })));
}

/**
 * 前後測 CSV。
 *
 * 一個人一列，每一題有「前測 / 後測 / 差」三欄 —— 交出去的成效報告
 * 通常就是要這個表，不用再自己算。量表題才有「差」，其他題型沒得相減。
 */
export function surveyCsv(results) {
  const columns = [
    { key: 'seq', label: '序號' },
    { key: 'name', label: '姓名' },
    { key: 'preAt', label: '前測填寫時間' },
    { key: 'postAt', label: '後測填寫時間' },
  ];
  for (const [i, q] of results.questions.entries()) {
    const n = i + 1;
    if (q.phase === 'both' || q.phase === 'pre') {
      columns.push({ key: `pre_${q.id}`, label: `${n}. ${q.text}（前測）` });
    }
    if (q.phase === 'both' || q.phase === 'post') {
      columns.push({ key: `post_${q.id}`, label: `${n}. ${q.text}（後測）` });
    }
    if (q.phase === 'both' && q.type === 'scale') {
      columns.push({ key: `diff_${q.id}`, label: `${n}. 差（後-前）` });
    }
  }

  const rows = results.people.map((p, i) => {
    const row = { seq: i + 1, name: p.name, preAt: p.preAt, postAt: p.postAt };
    for (const q of results.questions) {
      const pre = p.pre?.[q.id];
      const post = p.post?.[q.id];
      row[`pre_${q.id}`] = Array.isArray(pre) ? pre.join('; ') : (pre ?? '');
      row[`post_${q.id}`] = Array.isArray(post) ? post.join('; ') : (post ?? '');
      if (q.type === 'scale' && Number.isFinite(Number(pre)) && Number.isFinite(Number(post))) {
        row[`diff_${q.id}`] = Number(post) - Number(pre);
      }
    }
    return row;
  });

  const lines = [toCsv(columns, rows)];

  // 下面接一張每題的平均前後對照，成效報告直接複製這一段就好
  if (results.stats.length) {
    lines.push('');
    lines.push(toCsv(
      [
        { key: 'text', label: '題目（量表題，前後測都問的才算得出來）' },
        { key: 'n', label: '前後都填的人數' },
        { key: 'pre', label: '前測平均' },
        { key: 'post', label: '後測平均' },
        { key: 'diff', label: '平均進步' },
        { key: 'improved', label: '進步人數' },
        { key: 'same', label: '持平人數' },
        { key: 'dropped', label: '退步人數' },
      ],
      results.stats,
    ));
  }
  return lines.join('\r\n');
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

  // 系統算的與人工補的分開列一次，交出去的數字才講得清楚怎麼來的
  if (report.manualTotals && report.manualTotals.registrations) {
    push('');
    push('　其中：系統統計', report.counted.registrations);
    push('　其中：手動填入', report.manualTotals.registrations);
  }

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

  if (report.manualCounts && report.manualCounts.length) {
    push('');
    push('手動填入的人次（合辦活動等沒有簽到紀錄的）');
    push('月份', '活動名稱', '服務人次', '實際人數', '場次', '方案分類', '服務類型', '細分類', '備註');
    for (const m of report.manualCounts) {
      push(m.month, m.title, m.headcount, m.people, m.sessions,
        m.programCategory, m.serviceType, m.subCategory, m.note);
    }
    push('小計', '', report.manualTotals.registrations, report.manualTotals.people,
      report.manualTotals.sessions);
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
