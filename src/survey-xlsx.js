/**
 * 前後測匯出成 Excel，照園方給的範本（Google 表單回覆試算表的樣子）：
 *
 * 前測、後測各一張：
 *   第 1 列：時間戳記、姓名、每一題的題目（凍結，捲動時一直看得到）
 *   之後每人一列：填寫時間、姓名、每一題的回答（量表題寫「非常同意」這種字，不寫 1–5）
 *   空一列之後接一張百分比表：上面是「非常不同意 … 非常同意」，
 *   每一題量表題一列，用 COUNTIF／COUNTA 公式算各選項的比例（0%）。
 *   用公式而不是填死的數字：社工在上面刪掉或改一筆回答，比例會自己跟著變。
 *
 * 最後一張「前後對照」：前後都填的人，每題的平均與進步人數（原本 CSV 下面那一段）。
 */

import { Sheet, Workbook, STYLE, columnName, excelDateTime } from './xlsx-write.js';
import { SCALE_LABELS } from './model.js';

const PHASES = [['pre', '前測'], ['post', '後測']];

/** 一格要寫的字：量表題換成「同意」這種字，複選題用頓號串起來 */
function answerText(question, value) {
  if (value === null || value === undefined || value === '') return '';
  if (question.type === 'scale') {
    const n = Number(value);
    return Number.isInteger(n) && n >= 1 && n <= SCALE_LABELS.length ? SCALE_LABELS[n - 1] : String(value);
  }
  if (Array.isArray(value)) return value.join('、');
  return String(value);
}

function phaseSheet(results, phase, label) {
  const questions = results.questions.filter((q) => q.phase === 'both' || q.phase === phase);
  const people = results.people
    .filter((p) => p[phase])
    .sort((a, b) => String(a[`${phase}At`]).localeCompare(String(b[`${phase}At`])));

  const sheet = new Sheet(label, { freezeRows: 1, gridLines: true });
  // A 欄同時放填寫時間和下面百分比表的題目，跟範本一樣開寬一點題目才看得完整
  const hasScale = questions.some((q) => q.type === 'scale');
  const widths = { A: hasScale ? 47.5 : 20, B: 12 };
  sheet.text('A1', '時間戳記', STYLE.sheetHead).text('B1', '姓名', STYLE.sheetHead);
  questions.forEach((q, i) => {
    const col = columnName(i + 3);
    sheet.text(`${col}1`, q.text, STYLE.sheetHead);
    widths[col] = q.type === 'text' ? 30 : 22;
  });
  sheet.widths(widths);

  people.forEach((p, r) => {
    const row = r + 2;
    const at = excelDateTime(p[`${phase}At`]);
    if (at === null) sheet.text(`A${row}`, p[`${phase}At`] || '', STYLE.plain);
    else sheet.num(`A${row}`, at, STYLE.dateTime);
    sheet.text(`B${row}`, p.name, STYLE.plain);
    questions.forEach((q, i) => {
      const text = answerText(q, p[phase][q.id]);
      if (text) sheet.text(`${columnName(i + 3)}${row}`, text, STYLE.plain);
    });
  });

  // 百分比表：只有量表題、而且有人填過才排
  const scale = questions.map((q, i) => ({ q, col: columnName(i + 3) })).filter(({ q }) => q.type === 'scale');
  if (!people.length || !scale.length) return sheet;
  const last = people.length + 1;
  const head = last + 2;
  SCALE_LABELS.forEach((l, i) => sheet.text(`${columnName(i + 2)}${head}`, l, STYLE.small));
  scale.forEach(({ q, col }, k) => {
    const row = head + 1 + k;
    const range = `$${col}$2:$${col}$${last}`;
    const answers = people.map((p) => answerText(q, p[phase][q.id])).filter(Boolean);
    sheet.text(`A${row}`, q.text, STYLE.small);
    SCALE_LABELS.forEach((l, i) => {
      const at = columnName(i + 2);
      if (!answers.length) {
        sheet.num(`${at}${row}`, 0, STYLE.percent);
        return;
      }
      const share = answers.filter((a) => a === l).length / answers.length;
      sheet.formula(`${at}${row}`, `COUNTIF(${range},${at}$${head})/COUNTA(${range})`, STYLE.percent, share);
    });
  });
  return sheet;
}

function compareSheet(results) {
  const sheet = new Sheet('前後對照');
  sheet.widths({ A: 46, B: 12, C: 11, D: 11, E: 11, F: 10, G: 10, H: 10 });
  sheet.text('A1', '前後對照（量表題，前後測都問的才算得出來；只算前後都有填的人）', STYLE.plainTitle);
  const heads = ['題目', '前後都填的人數', '前測平均', '後測平均', '平均進步', '進步人數', '持平人數', '退步人數'];
  heads.forEach((h, i) => sheet.text(`${columnName(i + 1)}2`, h, STYLE.head));
  sheet.height(2, 33);
  results.stats.forEach((s, k) => {
    const row = k + 3;
    sheet.text(`A${row}`, s.text, STYLE.text);
    [s.n, s.pre, s.post, s.diff, s.improved, s.same, s.dropped]
      .forEach((v, i) => sheet.num(`${columnName(i + 2)}${row}`, v, STYLE.num));
  });
  return sheet;
}

/** surveyResults() 的結果 → .xlsx（Buffer） */
export function surveyWorkbook(results) {
  const book = new Workbook({ activeSheet: 0 });
  for (const [phase, label] of PHASES) {
    if (results.questions.some((q) => q.phase === 'both' || q.phase === phase)) {
      book.add(phaseSheet(results, phase, label));
    }
  }
  if (results.stats.length) book.add(compareSheet(results));
  if (!book.sheets.length) {
    book.add(new Sheet('前後測').text('A1', '這個活動還沒有設定前後測題目。', STYLE.plain));
  }
  return book.build();
}
