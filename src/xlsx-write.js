/**
 * 極簡的 .xlsx 產生器。
 *
 * 社會局的月報要的是「有格式的 Excel」，不是 CSV —— 合併儲存格、框線、
 * 底色都要照他們那份表，CSV 做不出來。
 *
 * xlsx 其實就是一個 zip，裡面放幾個 XML。Node 內建的 zlib 可以壓縮，
 * zip 的結構自己組就好，所以這裡不用裝任何套件
 * （整個專案只靠 pg 一個相依套件，這件事要守住）。
 *
 * 讀取的那一半在 src/xlsx.js。
 */

import { deflateRawSync } from 'node:zlib';

// ---------------------------------------------------------------- zip

let crcTable = null;
function crc32(buf) {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = crcTable[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** 把 [檔名, 內容] 的清單壓成一個 zip。 */
function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;

  for (const [name, content] of entries) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const packed = deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(name, 'utf8');
    const sum = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);     // 需要的版本
    local.writeUInt16LE(0, 6);      // 旗標
    local.writeUInt16LE(8, 8);      // deflate
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    nameBuf.copy(local, 30);
    parts.push(local, packed);

    const dir = Buffer.alloc(46 + nameBuf.length);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(sum, 16);
    dir.writeUInt32LE(packed.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    nameBuf.copy(dir, 46);
    central.push(dir);

    offset += local.length + packed.length;
  }

  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, dirBuf, end]);
}

// ---------------------------------------------------------------- 工具

/*
 * XML 不接受控制字元（tab、換行、回車除外）—— 夾帶進去的話，
 * Excel 打開會說「檔案已毀損」。
 *
 * 這裡刻意用字元碼判斷、不用正規表示式：字元類別寫成 regex 的話，
 * 原始碼裡就會真的出現控制字元，檔案會變成 git 眼中的二進位檔。
 */
function stripControl(text) {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0);
    if (code > 31 || code === 9 || code === 10 || code === 13) out += ch;
  }
  return out;
}

const escapeXml = (text) => stripControl(String(text))
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** 1 → A、27 → AA */
export function columnName(index) {
  let name = '';
  let n = index;
  while (n > 0) {
    const rest = (n - 1) % 26;
    name = String.fromCharCode(65 + rest) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

/** A → 1、AA → 27 */
export function columnIndex(name) {
  let n = 0;
  for (const ch of String(name).toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** Excel 的日期是「1899-12-30 起算的天數」。 */
export function excelSerial(date) {
  const [y, m, d] = String(date).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
}

// ---------------------------------------------------------------- 樣式

/*
 * 固定這幾種樣式就夠用了，名稱對應下面 cellXfs 的順序。
 * 要再加樣式的話，styles.xml 跟這張表要一起改。
 */
/*
 * 固定這幾種樣式就夠用了，名稱對應下面 cellXfs 的順序。
 * 要再加樣式的話，styles.xml 跟這張表要一起改。
 *
 * 黃／金／橘／綠這幾個色號是從園方那份月報表量出來的，改了貼進他們的
 * 大檔就會跟前幾個月長得不一樣，不要自己換。
 */
export const STYLE = {
  plain: 0,      // 什麼都沒有
  title: 1,      // 整份表最上面的大標
  blockTitle: 2, // 區塊標題（粗、鮮黃底、框線）
  head: 3,       // 表頭（粗、金黃底、框線、置中）
  label: 4,      // 左邊的項目名稱（框線）
  num: 5,        // 數字（框線、靠右）
  text: 6,       // 一般文字（框線）
  date: 7,       // 日期（框線、yyyy/mm/dd）
  total: 8,      // 合計（粗、橘底、框線）
  note: 9,       // 留白說明（淡色小字，不給框線）
  green: 10,     // 「男女分類/總計」那一格（粗、綠底）
  yellowLabel: 11, // 鮮黃底的項目名稱（總計表類的男／女、FB／IG 的欄位名）
  blocked: 12,   // 深灰：這一格本來就不用填
  mutedLabel: 13, // 淺灰底的項目名稱
  cream: 14,     // 米色：這一格要填（交誼區那一列）
  plainTitle: 15, // 沒有底色的區塊標題（總計表類那八張小表）
  blockedDark: 16, // 更深的灰（原表只有交誼區的「次數」那一格用這個）
};

const FONT_NAME = '微軟正黑體';

const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="176" formatCode="yyyy/mm/dd"/></numFmts>
<fonts count="5">
<font><sz val="11"/><name val="${FONT_NAME}"/></font>
<font><b/><sz val="16"/><name val="${FONT_NAME}"/></font>
<font><b/><sz val="11"/><name val="${FONT_NAME}"/></font>
<font><sz val="9"/><color rgb="FF808080"/><name val="${FONT_NAME}"/></font>
<font><b/><sz val="12"/><name val="${FONT_NAME}"/></font>
</fonts>
<fills count="10">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFC000"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFFD965"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF92D050"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF7F7F7F"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFD0CECE"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFFEF2CB"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF595959"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="17">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="176" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
<xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="一般" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

// ---------------------------------------------------------------- 一張工作表

/**
 * 一張工作表。用座標（'B14'）寫值，最後 build() 出整份 .xlsx。
 *
 * 之所以用座標而不是「一列一列 push」，是因為社會局那份表是好幾個
 * 區塊並排的（左邊場地、右邊活動明細），照座標寫才對得回原本的版面。
 */
export class Sheet {
  constructor(name = '工作表1') {
    this.name = name;
    this.cells = new Map();     // ref → { row, col, value, style, type }
    this.merges = [];
    this.columns = new Map();   // 欄名 → 寬度
    this.rowHeights = new Map();
  }

  #put(ref, value, style, type) {
    const match = /^([A-Z]+)(\d+)$/.exec(String(ref).toUpperCase());
    if (!match) throw new Error(`座標不正確：${ref}`);
    this.cells.set(match[0], {
      col: columnIndex(match[1]), row: Number(match[2]), value, style, type,
    });
    return this;
  }

  /** 文字。空字串也照樣寫，才會有框線。 */
  text(ref, value, style = STYLE.text) {
    return this.#put(ref, value == null ? '' : String(value), style, 'str');
  }

  /** 數字。null／undefined 會寫成空白（留白給人手填）。 */
  num(ref, value, style = STYLE.num) {
    if (value === null || value === undefined || value === '') return this.text(ref, '', style);
    return this.#put(ref, Number(value), style, 'num');
  }

  /**
   * 公式（不用寫等號）。
   *
   * 社會局那份表本來就是用公式把各區塊的總計串起來的
   * （當月服務總人次 = 諮詢 ＋ 場地 ＋ 社區工作 ＋ 活動）。
   * 照抄公式而不是算好再填死值，社工手動改了諮詢服務那幾格之後，
   * 底下的總計會自己跟著動 —— 填死的話他改完還要再自己重算一次。
   */
  formula(ref, expression, style = STYLE.num) {
    if (!expression) return this.text(ref, '', style);
    return this.#put(ref, String(expression).replace(/^=/, ''), style, 'formula');
  }

  /** 日期（yyyy/mm/dd）。 */
  date(ref, value, style = STYLE.date) {
    const serial = excelSerial(value);
    if (serial === null) return this.text(ref, '', style);
    return this.#put(ref, serial, style, 'num');
  }

  merge(range) {
    this.merges.push(String(range).toUpperCase());
    return this;
  }

  /** 欄寬。傳一個物件：{ A: 7.63, B: 9.13 } */
  widths(map) {
    for (const [name, width] of Object.entries(map)) this.columns.set(name.toUpperCase(), width);
    return this;
  }

  height(row, value) {
    this.rowHeights.set(Number(row), value);
    return this;
  }

  /**
   * 合併儲存格的框線與底色，要「整個範圍每一格都有樣式」才畫得出來。
   *
   * Excel 不會把左上角那一格的框線延伸到整個合併範圍 —— 只寫左上角的話，
   * 畫面上會變成「標題底下只有一小段底線」，框線在合併的中間就斷掉。
   * 所以送出去之前，把範圍內還沒有內容的格子補成同樣式的空白格。
   */
  #fillMergedStyles() {
    for (const range of this.merges) {
      const [from, to] = range.split(':');
      const a = /^([A-Z]+)(\d+)$/.exec(from);
      const b = /^([A-Z]+)(\d+)$/.exec(to || from);
      if (!a || !b) continue;
      const anchor = this.cells.get(from);
      if (!anchor) continue;
      const [c1, c2] = [columnIndex(a[1]), columnIndex(b[1])].sort((x, y) => x - y);
      const [r1, r2] = [Number(a[2]), Number(b[2])].sort((x, y) => x - y);
      for (let r = r1; r <= r2; r += 1) {
        for (let c = c1; c <= c2; c += 1) {
          const ref = `${columnName(c)}${r}`;
          if (this.cells.has(ref)) continue;
          this.cells.set(ref, { col: c, row: r, value: '', style: anchor.style, type: 'str' });
        }
      }
    }
  }

  #sheetXml() {
    this.#fillMergedStyles();
    const byRow = new Map();
    for (const cell of this.cells.values()) {
      if (!byRow.has(cell.row)) byRow.set(cell.row, []);
      byRow.get(cell.row).push(cell);
    }

    const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([row, cells]) => {
      const xml = cells.sort((a, b) => a.col - b.col).map((cell) => {
        const ref = `${columnName(cell.col)}${cell.row}`;
        const style = ` s="${cell.style || 0}"`;
        if (cell.type === 'num') return `<c r="${ref}"${style}><v>${cell.value}</v></c>`;
        // 不附算好的 <v>：Excel／LibreOffice 開檔時會自己算一次
        if (cell.type === 'formula') return `<c r="${ref}"${style}><f>${escapeXml(cell.value)}</f></c>`;
        if (cell.value === '') return `<c r="${ref}"${style}/>`;
        // inlineStr：不用另外維護 sharedStrings，檔案也讀得懂
        return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
      }).join('');
      const height = this.rowHeights.get(row);
      const attrs = height ? ` ht="${height}" customHeight="1"` : '';
      return `<row r="${row}"${attrs}>${xml}</row>`;
    }).join('');

    const cols = [...this.columns.entries()].map(([name, width]) => {
      const index = columnIndex(name);
      return `<col min="${index}" max="${index}" width="${width}" customWidth="1"/>`;
    }).join('');

    const merges = this.merges.length
      ? `<mergeCells count="${this.merges.length}">${
        this.merges.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>`
      : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<!-- 元素順序不能改：sheetPr 一定要排在 sheetViews 前面，Excel 才讀得下去 -->
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"/></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${rows}</sheetData>
${merges}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;
  }

  /** 產生整份 .xlsx（Buffer）。 */
  build() {
    return zip([
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\
<Default Extension="xml" ContentType="application/xml"/>\
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>\
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\
</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\
</Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" \
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\
<sheets><sheet name="${escapeXml(this.name)}" sheetId="1" r:id="rId1"/></sheets>\
<calcPr fullCalcOnLoad="1"/></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>\
<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\
</Relationships>`],
      ['xl/styles.xml', STYLES_XML],
      ['xl/worksheets/sheet1.xml', this.#sheetXml()],
    ]);
  }
}
