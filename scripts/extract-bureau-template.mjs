/**
 * 從園方的月報大檔，把「某一個月那張工作表的格式」抽出來，存成
 * src/bureau-template.js，讓系統產生的社會局月報跟他們的檔案長得一模一樣。
 *
 * 只抽格式，不抽任何資料：
 *   - 字型、框線、底色、數字格式、對齊（styles.xml 裡這張表用得到的那幾種）
 *   - 欄寬、列高、檢視比例、列印設定（橫印、縮放、邊界）
 *   - 每一格用哪一種格式
 *   - 佈景主題（字型的顏色有一部分是指向主題色）
 * 儲存格的值一個都不帶 —— 那份檔案裡有真實的活動名稱、人名、單位名稱。
 *
 * 用法（園方換了表格格式時再跑一次）：
 *   node scripts/extract-bureau-template.mjs 月報.xlsx 11509
 * 第二個參數是要照哪一張工作表，省略就用最後一張「民國年月」的工作表。
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { unzip } from '../src/xlsx.js';

// 只抽到第 56 列：底下是原表殘留的白底與零碎合併，畫面上看不到，帶過來只會多一堆雜訊
const MAX_ROW = 56;

const [, , file, wanted] = process.argv;
if (!file) {
  console.error('用法：node scripts/extract-bureau-template.mjs 月報.xlsx [工作表名稱]');
  process.exit(1);
}

const files = unzip(readFileSync(file));
const text = (name) => {
  const buf = files.get(name);
  if (!buf) throw new Error(`檔案裡沒有 ${name}`);
  return buf.toString('utf8');
};

/** 取出某個區段裡的每一個元素（自己關閉的 <x/> 或 <x>…</x>）。 */
function elements(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*?/>|<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`, 'g');
  return xml.match(re) || [];
}
function section(xml, tag) {
  const m = new RegExp(`<${tag}\\b[^>]*?(?:/>|>([\\s\\S]*?)</${tag}>)`).exec(xml);
  return m ? (m[1] || '') : '';
}
const attr = (xml, name) => {
  const m = new RegExp(`\\s${name}="([^"]*)"`).exec(xml);
  return m ? m[1] : null;
};
const setAttr = (xml, name, value) => (attr(xml, name) === null
  ? xml.replace(/^<(\w+)/, `<$1 ${name}="${value}"`)
  : xml.replace(new RegExp(`(\\s${name}=")[^"]*(")`), `$1${value}$2`));
const dropAttr = (xml, name) => xml.replace(new RegExp(`\\s${name}="[^"]*"`), '');

// ---------------------------------------------------------------- 找工作表
const workbook = text('xl/workbook.xml');
const rels = text('xl/_rels/workbook.xml.rels');
const sheets = elements(workbook, 'sheet').map((s) => ({
  name: attr(s, 'name'), rid: attr(s, 'r:id'),
}));
const target = wanted
  ? sheets.find((s) => s.name === wanted)
  : sheets.filter((s) => /^\d{5}$/.test(s.name)).pop();
if (!target) throw new Error(`找不到工作表 ${wanted || '（民國年月）'}；有：${sheets.map((s) => s.name).join('、')}`);
const rel = elements(rels, 'Relationship').find((r) => attr(r, 'Id') === target.rid);
const sheetXml = text(`xl/${attr(rel, 'Target').replace(/^\/?xl\//, '')}`);

// ---------------------------------------------------------------- 這張表用到的格式
const styles = text('xl/styles.xml');
const allXfs = elements(section(styles, 'cellXfs'), 'xf');
const allFonts = elements(section(styles, 'fonts'), 'font');
const allFills = elements(section(styles, 'fills'), 'fill');
const allBorders = elements(section(styles, 'borders'), 'border');
const allNumFmts = elements(section(styles, 'numFmts'), 'numFmt');

const rows = {};
const cells = {};
const usedXf = new Set([0]);
for (const row of elements(section(sheetXml, 'sheetData'), 'row')) {
  const r = Number(attr(row, 'r'));
  if (r > MAX_ROW) continue;
  const open = /^<row\b[^>]*>/.exec(row)?.[0] || row;
  const info = {};
  if (attr(open, 'ht')) info.ht = Number(attr(open, 'ht'));
  if (attr(open, 'customHeight') === '1') info.customHeight = true;
  if (attr(open, 'customFormat') === '1' && attr(open, 's')) {
    info.s = Number(attr(open, 's'));
    usedXf.add(info.s);
  }
  if (Object.keys(info).length) rows[r] = info;
  // 沒寫 s 的格子也要記（＝第 0 號格式）；不記的話會改吃欄的預設格式，跟原表不一樣
  for (const c of elements(row, 'c')) {
    const s = Number(attr(c, 's') || 0);
    cells[attr(c, 'r')] = s;
    usedXf.add(s);
  }
}
const colsXml = elements(section(sheetXml, 'cols'), 'col');
for (const col of colsXml) if (attr(col, 'style')) usedXf.add(Number(attr(col, 'style')));

// 重新編號：只留用得到的，第 0 號一律是原檔的預設格式
const xfOrder = [...usedXf].sort((a, b) => a - b);
const xfMap = new Map(xfOrder.map((old, i) => [old, i]));
const pick = (list, keep) => {
  const order = [...keep].sort((a, b) => a - b);
  return { map: new Map(order.map((old, i) => [old, i])), items: order.map((i) => list[i]) };
};
const fontIds = new Set([0]);
const fillIds = new Set([0, 1]); // 0＝無、1＝gray125，Excel 規定一定要有
const borderIds = new Set([0]);
const numFmtIds = new Set();
for (const i of xfOrder) {
  const xf = allXfs[i];
  fontIds.add(Number(attr(xf, 'fontId') || 0));
  fillIds.add(Number(attr(xf, 'fillId') || 0));
  borderIds.add(Number(attr(xf, 'borderId') || 0));
  const fmt = Number(attr(xf, 'numFmtId') || 0);
  if (fmt >= 164) numFmtIds.add(fmt);
}
const fonts = pick(allFonts, fontIds);
const fills = pick(allFills, fillIds);
const borders = pick(allBorders, borderIds);
const numFmts = allNumFmts.filter((f) => numFmtIds.has(Number(attr(f, 'numFmtId'))));

const cellXfs = xfOrder.map((i) => {
  let xf = allXfs[i];
  xf = setAttr(xf, 'fontId', fonts.map.get(Number(attr(xf, 'fontId') || 0)));
  xf = setAttr(xf, 'fillId', fills.map.get(Number(attr(xf, 'fillId') || 0)));
  xf = setAttr(xf, 'borderId', borders.map.get(Number(attr(xf, 'borderId') || 0)));
  xf = setAttr(xf, 'xfId', 0); // 具名樣式不帶過來，每一格的格式本來就寫在自己身上
  return xf;
});

for (const [ref, s] of Object.entries(cells)) cells[ref] = xfMap.get(s);
for (const info of Object.values(rows)) if (info.s !== undefined) info.s = xfMap.get(info.s);
const cols = colsXml.map((col) => (attr(col, 'style')
  ? setAttr(col, 'style', xfMap.get(Number(attr(col, 'style')))) : col));

// ---------------------------------------------------------------- 工作表層級的設定
const one = (tag) => (sheetXml.match(new RegExp(`<${tag}\\b[^>]*?/>|<${tag}\\b[^>]*>[\\s\\S]*?</${tag}>`)) || [''])[0];
// 檢視：只留比例與格線，不帶「目前選到哪一格」「是不是作用中的分頁」
let sheetView = (/<sheetView\b[^>]*?>|<sheetView\b[^>]*?\/>/.exec(sheetXml) || ['<sheetView>'])[0]
  .replace(/\/?>$/, '/>');
for (const name of ['tabSelected', 'topLeftCell']) sheetView = dropAttr(sheetView, name);
const template = {
  source: target.name,
  maxRow: MAX_ROW,
  styles: {
    numFmts,
    fonts: fonts.items,
    fills: fills.items,
    borders: borders.items,
    cellXfs,
    cellStyleXf: allXfs.length ? elements(section(styles, 'cellStyleXfs'), 'xf')[0] : '',
  },
  theme: files.has('xl/theme/theme1.xml') ? text('xl/theme/theme1.xml') : '',
  sheet: {
    sheetPr: one('sheetPr'),
    sheetView,
    sheetFormatPr: one('sheetFormatPr'),
    cols,
    printOptions: one('printOptions'),
    pageMargins: one('pageMargins'),
    // r:id 指向原檔的印表機設定檔（二進位），不帶
    pageSetup: dropAttr(one('pageSetup'), 'r:id'),
  },
  rows,
  cells,
};

const out = new URL('../src/bureau-template.js', import.meta.url);
writeFileSync(out, `// 由 scripts/extract-bureau-template.mjs 從園方月報「${target.name}」抽出來的格式，不要手改。
// 只有格式（字型、框線、底色、欄寬、列高、列印設定），沒有任何儲存格的值。
export default ${JSON.stringify(template, null, 1)};
`);
console.log(`已從「${target.name}」抽出：${cellXfs.length} 種格式、${Object.keys(cells).length} 格、`
  + `${Object.keys(rows).length} 列的列高 → src/bureau-template.js`);
