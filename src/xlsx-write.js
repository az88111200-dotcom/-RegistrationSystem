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
    // 預設壓縮等級就好：9 級在月報這種 5MB 的 XML 上要多花一秒，檔案只小一點點
    const packed = deflateRawSync(data, { level: 6 });
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

/** 系統自己的那幾種樣式（STYLE 的編號就是 cellXfs 的順序）。 */
const OWN_STYLES = {
  numFmts: ['<numFmt numFmtId="176" formatCode="yyyy/mm/dd"/>'],
  fonts: [
    `<font><sz val="11"/><name val="${FONT_NAME}"/></font>`,
    `<font><b/><sz val="16"/><name val="${FONT_NAME}"/></font>`,
    `<font><b/><sz val="11"/><name val="${FONT_NAME}"/></font>`,
    `<font><sz val="9"/><color rgb="FF808080"/><name val="${FONT_NAME}"/></font>`,
    `<font><b/><sz val="12"/><name val="${FONT_NAME}"/></font>`,
  ],
  fills: [
    '<fill><patternFill patternType="none"/></fill>',
    '<fill><patternFill patternType="gray125"/></fill>',
    ...['FFFFFF00', 'FFFFC000', 'FFFFD965', 'FF92D050', 'FF7F7F7F', 'FFD0CECE', 'FFFEF2CB', 'FF595959']
      .map((rgb) => `<fill><patternFill patternType="solid"><fgColor rgb="${rgb}"/><bgColor indexed="64"/></patternFill></fill>`),
  ],
  borders: [
    '<border><left/><right/><top/><bottom/><diagonal/></border>',
    '<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border>',
  ],
  cellXfs: [
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>',
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="2" fillId="4" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>',
    '<xf numFmtId="176" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="2" fillId="5" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="6" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>',
    '<xf numFmtId="0" fontId="0" fillId="7" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="8" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="right" vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="4" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>',
    '<xf numFmtId="0" fontId="0" fillId="9" borderId="1" xfId="0" applyFill="1" applyBorder="1"/>',
  ],
  cellStyleXf: '<xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>',
};

function stylesXml(parts) {
  const list = (tag, items) => `<${tag} count="${items.length}">${items.join('')}</${tag}>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\
${parts.numFmts.length ? list('numFmts', parts.numFmts) : ''}\
${list('fonts', parts.fonts)}${list('fills', parts.fills)}${list('borders', parts.borders)}\
<cellStyleXfs count="1">${parts.cellStyleXf}</cellStyleXfs>\
${list('cellXfs', parts.cellXfs)}\
<cellStyles count="1"><cellStyle name="一般" xfId="0" builtinId="0"/></cellStyles>\
</styleSheet>`;
}

const idOf = (xml, name) => Number((new RegExp(`\\s${name}="(\\d+)"`).exec(xml) || [])[1] || 0);
const withId = (xml, name, value) => xml.replace(new RegExp(`(\\s${name}=")\\d+(")`), `$1${value}$2`);

/**
 * 園方的格式在前（編號不動，範本裡記的格式編號直接能用），
 * 系統自己的那幾種接在後面（回傳 ownBase：STYLE.x 在合併後是 ownBase + x）。
 * 範本沒有畫到的格子（例如頁尾的提醒）才會用到系統自己的樣式。
 */
function combineStyles(template) {
  const t = template.styles;
  const fmtBase = Math.max(175, ...t.numFmts.map((f) => idOf(f, 'numFmtId'))) + 1;
  const fmtMap = new Map(OWN_STYLES.numFmts.map((f, i) => [idOf(f, 'numFmtId'), fmtBase + i]));
  const fontBase = t.fonts.length;
  // 系統的 fill 0／1（無、gray125）直接用範本的 0／1，其餘接在後面
  const fillBase = t.fills.length - 2;
  // 系統的 border 0（無框）用範本的 0，其餘接在後面
  const borderBase = t.borders.length - 1;
  const own = OWN_STYLES.cellXfs.map((xf) => {
    let out = withId(xf, 'fontId', fontBase + idOf(xf, 'fontId'));
    const fill = idOf(xf, 'fillId');
    out = withId(out, 'fillId', fill < 2 ? fill : fillBase + fill);
    const border = idOf(xf, 'borderId');
    out = withId(out, 'borderId', border < 1 ? border : borderBase + border);
    const fmt = idOf(xf, 'numFmtId');
    return fmtMap.has(fmt) ? withId(out, 'numFmtId', fmtMap.get(fmt)) : out;
  });
  return {
    ownBase: t.cellXfs.length,
    parts: {
      numFmts: [...t.numFmts, ...OWN_STYLES.numFmts.map((f) => withId(f, 'numFmtId', fmtMap.get(idOf(f, 'numFmtId'))))],
      fonts: [...t.fonts, ...OWN_STYLES.fonts],
      fills: [...t.fills, ...OWN_STYLES.fills.slice(2)],
      borders: [...t.borders, ...OWN_STYLES.borders.slice(1)],
      cellXfs: [...t.cellXfs, ...own],
      cellStyleXf: t.cellStyleXf || OWN_STYLES.cellStyleXf,
    },
  };
}

const formatCodeOf = (numFmt) => /formatCode="([^"]*)"/.exec(numFmt)?.[1] ?? '';

/**
 * 把另一本 Excel 的格式（只取 used 那幾號）接到 parts 後面，回傳「舊編號 → 新編號」。
 *
 * 字型、底色、框線照原樣接在後面；自訂的數字格式（164 號以後）
 * 格式字串一樣的就共用同一個編號，不一樣的給新編號。
 */
function importStyles(parts, source, used) {
  const append = (list, item, cache, key) => {
    if (!cache.has(key)) { list.push(item); cache.set(key, list.length - 1); }
    return cache.get(key);
  };
  const fonts = new Map();
  const fills = new Map();
  const borders = new Map();
  let nextFmt = Math.max(175, ...parts.numFmts.map((f) => idOf(f, 'numFmtId'))) + 1;
  const fmtByCode = new Map(parts.numFmts.map((f) => [formatCodeOf(f), idOf(f, 'numFmtId')]));
  const sourceFmts = new Map(source.numFmts.map((f) => [idOf(f, 'numFmtId'), f]));
  const map = new Map();
  for (const old of [...used].sort((a, b) => a - b)) {
    let xf = source.cellXfs[old] || source.cellXfs[0];
    const font = idOf(xf, 'fontId');
    const fill = idOf(xf, 'fillId');
    const border = idOf(xf, 'borderId');
    xf = withId(xf, 'fontId', append(parts.fonts, source.fonts[font] || source.fonts[0], fonts, font));
    xf = withId(xf, 'fillId', append(parts.fills, source.fills[fill] || source.fills[0], fills, fill));
    xf = withId(xf, 'borderId', append(parts.borders, source.borders[border] || source.borders[0], borders, border));
    const fmt = idOf(xf, 'numFmtId');
    if (fmt >= 164 && sourceFmts.has(fmt)) {
      const code = formatCodeOf(sourceFmts.get(fmt));
      if (!fmtByCode.has(code)) {
        parts.numFmts.push(withId(sourceFmts.get(fmt), 'numFmtId', nextFmt));
        fmtByCode.set(code, nextFmt);
        nextFmt += 1;
      }
      xf = withId(xf, 'numFmtId', fmtByCode.get(code));
    }
    // 具名樣式不帶過來（輸出只有一個預設的具名樣式）
    xf = xf.replace(/\sxfId="\d+"/, ' xfId="0"');
    parts.cellXfs.push(xf);
    map.set(old, parts.cellXfs.length - 1);
  }
  return map;
}

// ---------------------------------------------------------------- 原封不動的工作表

/**
 * 從別本 Excel 原封不動搬過來的一張工作表（園方自己做的舊月份）。
 *
 * 內容、格式、公式、欄寬列高、列印設定都照原檔；只做搬家必要的處理：
 *   - 共用文字表的文字改寫進格子裡（這本檔案沒有共用文字表）
 *   - 格式編號換成這本檔案裡的編號
 *   - 拿掉指向原檔其他零件的東西（印表機設定、注音設定）
 */
export class RawSheet {
  /** source：readRawSheets() 的結果（同一本檔案的每一張都傳同一個物件） */
  constructor(name, xml, source) {
    this.name = name;
    this.xml = xml;
    this.source = source;
  }

  /** 這張用到哪些格式編號。 */
  usedStyles() {
    const used = new Set([0]);
    for (const m of this.xml.matchAll(/<(?:c|row)\b[^>]*?\ss="(\d+)"/g)) used.add(Number(m[1]));
    for (const m of this.xml.matchAll(/<col\b[^>]*?\sstyle="(\d+)"/g)) used.add(Number(m[1]));
    return used;
  }

  sheetXml({ styleMap, selected = false }) {
    const mapped = (n) => styleMap.get(Number(n)) ?? 0;
    const strings = this.source.strings;
    return this.xml
      .replace(/<c\b([^>]*?)\st="s"([^>]*)>\s*<v>(\d+)<\/v>\s*<\/c>/g, (_, a, b, n) => {
        // 注音（rPh／phoneticPr）會指到原檔的字型，拿掉
        const inner = (strings[Number(n)] || '')
          .replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').replace(/<phoneticPr\b[^>]*\/>/g, '');
        return `<c${a} t="inlineStr"${b}><is>${inner}</is></c>`;
      })
      .replace(/(<(?:c|row)\b[^>]*?\ss=")(\d+)(")/g, (_, a, n, b) => `${a}${mapped(n)}${b}`)
      .replace(/(<col\b[^>]*?\sstyle=")(\d+)(")/g, (_, a, n, b) => `${a}${mapped(n)}${b}`)
      .replace(/<phoneticPr\b[^>]*\/>/g, '')
      .replace(/\stabSelected="1"/g, '')
      .replace(/(<sheetView\b)/, selected ? '$1 tabSelected="1"' : '$1')
      .replace(/(<pageSetup\b[^>]*?)\sr:id="[^"]*"/, '$1')
      .replace(/<(legacyDrawing|drawing|tableParts)\b[^>]*\/>/g, '');
  }
}

// ---------------------------------------------------------------- 一張工作表

/**
 * 一張工作表。用座標（'B14'）寫值，最後放進 Workbook 產生整份 .xlsx。
 *
 * 之所以用座標而不是「一列一列 push」，是因為社會局那份表是好幾個
 * 區塊並排的（左邊場地、右邊活動明細），照座標寫才對得回原本的版面。
 *
 * 給了 template（scripts/extract-bureau-template.mjs 抽出來的格式）的話，
 * 欄寬、列印設定、檢視比例都照範本，每一格的格式用 styleAt() 指定的範本格式；
 * 沒指定的格子才退回系統自己的 STYLE。
 */
export class Sheet {
  constructor(name = '工作表1', { template = null } = {}) {
    this.name = name;
    this.template = template;
    this.cells = new Map();     // ref → { row, col, value, style, type }
    this.merges = [];
    this.columns = new Map();   // 欄名 → 寬度
    this.rowHeights = new Map();
    this.templateStyles = new Map(); // ref → 範本裡的格式編號
    this.rowStyles = new Map();      // 列 → 範本裡整列的格式編號（沒有格子的地方吃這個）
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

  /** 日期（yyyy/mm/dd；套範本時照範本那一格的日期格式）。 */
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
   * 這一格用範本的哪一種格式。沒寫值的格子也會照樣畫出來（框線、底色）。
   */
  styleAt(ref, templateStyle) {
    this.templateStyles.set(String(ref).toUpperCase(), templateStyle);
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

  /** ownBase：套範本時，系統自己的 STYLE.x 在合併後的格式表裡是 ownBase + x。 */
  sheetXml({ ownBase = 0, selected = false } = {}) {
    this.#fillMergedStyles();
    const all = new Map(this.cells);
    // 範本有畫、但沒寫值的格子：補成空白格，框線與底色才會出來
    for (const ref of this.templateStyles.keys()) {
      if (all.has(ref)) continue;
      const m = /^([A-Z]+)(\d+)$/.exec(ref);
      all.set(ref, { col: columnIndex(m[1]), row: Number(m[2]), value: '', style: null, type: 'str' });
    }
    const styleOf = (ref, cell) => {
      if (this.templateStyles.has(ref)) return this.templateStyles.get(ref);
      if (!this.template) return cell.style || 0;
      // 套範本時，沒有特別指定樣式的格子就讓它吃欄的預設（跟原表一樣）
      return cell.style ? ownBase + cell.style : null;
    };

    const byRow = new Map();
    for (const cell of all.values()) {
      if (!byRow.has(cell.row)) byRow.set(cell.row, []);
      byRow.get(cell.row).push(cell);
    }
    for (const row of [...this.rowHeights.keys(), ...this.rowStyles.keys()]) {
      if (!byRow.has(row)) byRow.set(row, []);
    }

    const rows = [...byRow.entries()].sort((a, b) => a[0] - b[0]).map(([row, cells]) => {
      const xml = cells.sort((a, b) => a.col - b.col).map((cell) => {
        const ref = `${columnName(cell.col)}${cell.row}`;
        const s = styleOf(ref, cell);
        const style = s === null || s === undefined ? '' : ` s="${s}"`;
        if (cell.type === 'num') return `<c r="${ref}"${style}><v>${cell.value}</v></c>`;
        // 不附算好的 <v>：Excel／LibreOffice 開檔時會自己算一次
        if (cell.type === 'formula') return `<c r="${ref}"${style}><f>${escapeXml(cell.value)}</f></c>`;
        if (cell.value === '') return `<c r="${ref}"${style}/>`;
        // inlineStr：不用另外維護 sharedStrings，檔案也讀得懂
        return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${escapeXml(cell.value)}</t></is></c>`;
      }).join('');
      const height = this.rowHeights.get(row);
      let attrs = height ? ` ht="${height}" customHeight="1"` : '';
      if (this.rowStyles.has(row)) attrs += ` s="${this.rowStyles.get(row)}" customFormat="1"`;
      return `<row r="${row}"${attrs}>${xml}</row>`;
    }).join('');

    const merges = this.merges.length
      ? `<mergeCells count="${this.merges.length}">${
        this.merges.map((r) => `<mergeCell ref="${r}"/>`).join('')}</mergeCells>`
      : '';

    const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">\n';
    // 元素順序不能改：sheetPr → sheetViews → sheetFormatPr → cols → sheetData → mergeCells → 列印
    if (this.template) {
      const t = this.template.sheet;
      const view = selected ? t.sheetView.replace('<sheetView', '<sheetView tabSelected="1"') : t.sheetView;
      return `${head}${t.sheetPr}<sheetViews>${view}</sheetViews>${t.sheetFormatPr}`
        + `<cols>${t.cols.join('')}</cols><sheetData>${rows}</sheetData>${merges}`
        + `${t.printOptions}${t.pageMargins}${t.pageSetup}</worksheet>`;
    }

    const cols = [...this.columns.entries()].map(([name, width]) => {
      const index = columnIndex(name);
      return `<col min="${index}" max="${index}" width="${width}" customWidth="1"/>`;
    }).join('');
    return `${head}<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>
<sheetViews><sheetView workbookViewId="0" showGridLines="0"${selected ? ' tabSelected="1"' : ''}/></sheetViews>
<sheetFormatPr defaultRowHeight="18"/>
${cols ? `<cols>${cols}</cols>` : ''}
<sheetData>${rows}</sheetData>
${merges}
<printOptions horizontalCentered="1"/>
<pageMargins left="0.3" right="0.3" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="9"/>
</worksheet>`;
  }

  /** 只有這一張的 .xlsx（Buffer）。 */
  build() {
    return new Workbook({ template: this.template }).add(this).build();
  }
}

// ---------------------------------------------------------------- 整本活頁簿

/**
 * 好幾張工作表放在同一個檔案（社會局月報：一個月一張，照園方大檔的做法）。
 * 打開時停在最後一張。
 */
export class Workbook {
  constructor({ template = null } = {}) {
    this.template = template;
    this.sheets = [];
  }

  add(sheet) {
    this.sheets.push(sheet);
    return this;
  }

  build() {
    if (!this.sheets.length) throw new Error('活頁簿裡沒有工作表。');
    const styles = this.template
      ? combineStyles(this.template)
      : { parts: { ...OWN_STYLES, numFmts: [...OWN_STYLES.numFmts], fonts: [...OWN_STYLES.fonts], fills: [...OWN_STYLES.fills], borders: [...OWN_STYLES.borders], cellXfs: [...OWN_STYLES.cellXfs] }, ownBase: 0 };
    // 原封不動搬過來的工作表：同一本來源檔案的格式只接一次
    const styleMaps = new Map();
    for (const sheet of this.sheets) {
      if (!(sheet instanceof RawSheet) || styleMaps.has(sheet.source)) continue;
      const used = new Set();
      for (const other of this.sheets) {
        if (other instanceof RawSheet && other.source === sheet.source) {
          for (const n of other.usedStyles()) used.add(n);
        }
      }
      styleMaps.set(sheet.source, importStyles(styles.parts, sheet.source.styles, used));
    }
    const theme = this.template?.theme || '';
    const last = this.sheets.length - 1;
    const sheetParts = this.sheets.map((sheet, i) => [
      `xl/worksheets/sheet${i + 1}.xml`,
      sheet instanceof RawSheet
        ? sheet.sheetXml({ styleMap: styleMaps.get(sheet.source), selected: i === last })
        : sheet.sheetXml({ ownBase: styles.ownBase, selected: i === last }),
    ]);
    const overrides = this.sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" `
      + 'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('');
    const sheetRels = this.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" `
      + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" '
      + `Target="worksheets/sheet${i + 1}.xml"/>`).join('');
    const n = this.sheets.length;
    return zip([
      ['[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\
<Default Extension="xml" ContentType="application/xml"/>\
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>\
${overrides}\
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>\
${theme ? '<Override PartName="/xl/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>' : ''}\
</Types>`],
      ['_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>\
</Relationships>`],
      ['xl/workbook.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" \
xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\
<bookViews><workbookView activeTab="${last}"/></bookViews>\
<sheets>${this.sheets.map((sheet, i) => `<sheet name="${escapeXml(sheet.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets>\
<calcPr fullCalcOnLoad="1"/></workbook>`],
      ['xl/_rels/workbook.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\
${sheetRels}\
<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>\
${theme ? `<Relationship Id="rId${n + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/>` : ''}\
</Relationships>`],
      ['xl/styles.xml', stylesXml(styles.parts)],
      ...(theme ? [['xl/theme/theme1.xml', theme]] : []),
      ...sheetParts,
    ]);
  }
}
