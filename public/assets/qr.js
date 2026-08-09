// 最小的 QR Code 產生器（byte 模式、容錯等級 M）。
//
// 為什麼要自己寫：站台的 CSP 只允許同源資源，不能載入外部的 QR 套件；
// 簽到又一定要有 QR 可以掃，所以把編碼流程實作在這裡。
//
// 只實作簽到網址會用到的部分：byte 模式、版本 1-10、容錯等級 M。

// ---------------------------------------------------------------- 有限體運算

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d; // QR 用的生成多項式
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
})();

const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/**
 * 產生 Reed-Solomon 的生成多項式 (x-α⁰)(x-α¹)…(x-α^(degree-1))。
 *
 * 內部用升冪計算（poly[j] 是 x^j 的係數），最後反轉成降冪回傳，
 * 因為 rsEncode 的長除法需要 gen[0] 是最高次項。
 */
function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= mul(poly[j], EXP[i]);
      next[j + 1] ^= poly[j];
    }
    poly = next;
  }
  return poly.reverse();
}

/** 算出一段資料的錯誤更正碼。 */
function rsEncode(data, ecLength) {
  const gen = rsGenerator(ecLength);
  const result = new Uint8Array(ecLength);
  for (const byte of data) {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[ecLength - 1] = 0;
    for (let i = 0; i < ecLength; i += 1) result[i] ^= mul(gen[i + 1], factor);
  }
  return result;
}

// ---------------------------------------------------------------- 版本參數

// [版本] = [資料碼字總數, 錯誤更正碼字數/區塊, 區塊1數量, 區塊2數量]
// 容錯等級 M。資料來自 QR 規格的表 7-9。
const VERSIONS = {
  1: [16, 10, 1, 0],
  2: [28, 16, 1, 0],
  3: [44, 26, 1, 0],
  4: [64, 18, 2, 0],
  5: [86, 24, 2, 0],
  6: [108, 16, 4, 0],
  7: [124, 18, 4, 0],
  8: [154, 22, 2, 2],
  9: [182, 22, 3, 2],
  10: [216, 26, 4, 1],
};

const ALIGN_POS = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

/** 選出裝得下這段資料的最小版本。 */
function pickVersion(byteLength) {
  for (let v = 1; v <= 10; v += 1) {
    const [dataCodewords] = VERSIONS[v];
    const lengthBits = v < 10 ? 8 : 16;
    const needed = Math.ceil((4 + lengthBits + byteLength * 8) / 8);
    if (needed <= dataCodewords) return v;
  }
  throw new Error('內容太長，這個 QR 產生器最多支援版本 10。');
}

// ---------------------------------------------------------------- 位元組合

function buildCodewords(bytes, version) {
  const [dataCodewords, ecPerBlock, blocks1, blocks2] = VERSIONS[version];
  const lengthBits = version < 10 ? 8 : 16;

  // 模式指示碼（byte 模式 = 0100）+ 長度 + 資料
  const bits = [];
  const push = (value, count) => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, lengthBits);
  for (const b of bytes) push(b, 8);

  // 結束符與補到整個位元組
  const capacity = dataCodewords * 8;
  for (let i = 0; i < 4 && bits.length < capacity; i += 1) bits.push(0);
  while (bits.length % 8 !== 0) bits.push(0);

  const data = [];
  for (let i = 0; i < bits.length; i += 8) {
    data.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  }
  // 填充碼字，規格規定交替使用這兩個值
  const PAD = [0xec, 0x11];
  while (data.length < dataCodewords) data.push(PAD[(data.length - bits.length / 8) % 2]);

  // 切成區塊，各自算錯誤更正碼
  const totalBlocks = blocks1 + blocks2;
  const shortLen = Math.floor(dataCodewords / totalBlocks);
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < totalBlocks; i += 1) {
    const len = i < blocks1 ? shortLen : shortLen + 1;
    const block = data.slice(offset, offset + len);
    offset += len;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, ecPerBlock));
  }

  // 交錯排列
  const result = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]);
  }
  for (let i = 0; i < ecPerBlock; i += 1) {
    for (const block of ecBlocks) result.push(block[i]);
  }
  return result;
}

// ---------------------------------------------------------------- 排版

/** 版本資訊：6 位元版本號 + 12 位元 BCH 錯誤更正。 */
function versionBits(version) {
  let rem = version;
  for (let i = 0; i < 12; i += 1) {
    rem = (rem << 1) ^ ((rem >> 11) * 0x1f25);
  }
  return (version << 12) | rem;
}

function placePatterns(size, version) {
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const setArea = (r0, c0, h, w, fn) => {
    for (let r = 0; r < h; r += 1) {
      for (let c = 0; c < w; c += 1) {
        const r1 = r0 + r;
        const c1 = c0 + c;
        if (r1 < 0 || c1 < 0 || r1 >= size || c1 >= size) continue;
        modules[r1][c1] = fn(r, c);
        reserved[r1][c1] = true;
      }
    }
  };

  // 三個定位圖案與周圍的分隔
  const finder = (r0, c0) => {
    setArea(r0 - 1, c0 - 1, 9, 9, () => 0);
    setArea(r0, c0, 7, 7, (r, c) => {
      const edge = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      return edge || core ? 1 : 0;
    });
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // 校準圖案
  const positions = ALIGN_POS[version];
  for (const r of positions) {
    for (const c of positions) {
      // 跟定位圖案重疊的位置不放
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      setArea(r - 2, c - 2, 5, 5, (dr, dc) => {
        const d = Math.max(Math.abs(dr - 2), Math.abs(dc - 2));
        return d === 1 ? 0 : 1;
      });
    }
  }

  // 版本 7 以上必須額外嵌入 18 位元的版本資訊，
  // 少了這塊，掃描器認不出尺寸，整個碼就讀不出來。
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i += 1) {
      const value = (bits >> i) & 1;
      const a = Math.floor(i / 3);
      const b = i % 3;
      modules[size - 11 + b][a] = value;       // 左下角那塊
      reserved[size - 11 + b][a] = true;
      modules[a][size - 11 + b] = value;       // 右上角那塊
      reserved[a][size - 11 + b] = true;
    }
  }

  // 時序圖案
  for (let i = 8; i < size - 8; i += 1) {
    modules[6][i] = i % 2 === 0 ? 1 : 0;
    modules[i][6] = i % 2 === 0 ? 1 : 0;
    reserved[6][i] = true;
    reserved[i][6] = true;
  }

  // 固定為深色的模組，以及保留給格式資訊的位置
  modules[size - 8][8] = 1;
  reserved[size - 8][8] = true;
  for (let i = 0; i < 9; i += 1) {
    if (!reserved[8][i]) { modules[8][i] = 0; reserved[8][i] = true; }
    if (!reserved[i][8]) { modules[i][8] = 0; reserved[i][8] = true; }
  }
  for (let i = 0; i < 8; i += 1) {
    if (!reserved[8][size - 1 - i]) { modules[8][size - 1 - i] = 0; reserved[8][size - 1 - i] = true; }
    if (!reserved[size - 1 - i][8]) { modules[size - 1 - i][8] = 0; reserved[size - 1 - i][8] = true; }
  }

  return { modules, reserved };
}

/** 把資料位元由右下往左上、之字形填進去。 */
function placeData(modules, reserved, codewords, size) {
  const bits = [];
  for (const cw of codewords) {
    for (let i = 7; i >= 0; i -= 1) bits.push((cw >> i) & 1);
  }

  let index = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    // 第 6 欄是垂直時序圖案，整組欄位往左挪一格，
    // 而且後續的配對要從挪過的位置繼續（不能只挪這一輪）。
    if (right === 6) right = 5;
    for (let i = 0; i < size; i += 1) {
      const row = upward ? size - 1 - i : i;
      for (const c of [right, right - 1]) {
        if (reserved[row][c]) continue;
        modules[row][c] = index < bits.length ? bits[index] : 0;
        index += 1;
      }
    }
    upward = !upward;
  }
}

const MASKS = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** 格式資訊：容錯等級 M(00) + 遮罩編號，帶 BCH 錯誤更正。 */
function formatBits(maskIndex) {
  const data = (0b00 << 3) | maskIndex;
  let rem = data;
  for (let i = 0; i < 10; i += 1) {
    rem <<= 1;
    if (rem & 0x400) rem ^= 0x537;
  }
  return ((data << 10) | rem) ^ 0x5412;
}

/**
 * 把 15 個格式位元放到規格指定的兩個位置。
 *
 * 位元編號以 bit 0 為最低位。左上角那份：橫的一列放高位（bit14→bit9），
 * 直的一行放低位（bit0→bit5）——兩者方向相反，很容易寫反。
 */
function applyFormat(modules, size, maskIndex) {
  const bits = formatBits(maskIndex);
  const bit = (i) => (bits >> i) & 1;

  // 左上角這一份
  for (let i = 0; i <= 5; i += 1) modules[8][i] = bit(14 - i);
  modules[8][7] = bit(8);
  modules[8][8] = bit(7);
  modules[7][8] = bit(6);
  for (let i = 0; i <= 5; i += 1) modules[i][8] = bit(i);

  // 右上與左下那一份：從左下角往上、再接右上角往右，
  // 位元由 bit14 連續遞減到 bit0（跟左上角那份的順序不一樣）
  for (let i = 0; i <= 6; i += 1) modules[size - 1 - i][8] = bit(14 - i);
  for (let j = 0; j <= 7; j += 1) modules[8][size - 8 + j] = bit(7 - j);
}

/** 遮罩的懲罰分數，分數越低代表越好掃。 */
function penalty(modules, size) {
  let score = 0;

  // 同色連續 5 個以上
  for (let i = 0; i < size; i += 1) {
    for (const line of [modules[i], modules.map((row) => row[i])]) {
      let run = 1;
      for (let j = 1; j < size; j += 1) {
        if (line[j] === line[j - 1]) {
          run += 1;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
  }

  // 2x2 同色方塊
  for (let r = 0; r < size - 1; r += 1) {
    for (let c = 0; c < size - 1; c += 1) {
      const v = modules[r][c];
      if (v === modules[r][c + 1] && v === modules[r + 1][c] && v === modules[r + 1][c + 1]) {
        score += 3;
      }
    }
  }

  // 深淺比例偏離一半的程度
  let dark = 0;
  for (let r = 0; r < size; r += 1) for (let c = 0; c < size; c += 1) dark += modules[r][c];
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

/**
 * 產生 QR 的模組矩陣（true = 深色）。
 */
export function encodeQr(text) {
  const bytes = new TextEncoder().encode(String(text));
  const version = pickVersion(bytes.length);
  const size = version * 4 + 17;
  const codewords = buildCodewords(bytes, version);

  let best = null;
  for (let maskIndex = 0; maskIndex < 8; maskIndex += 1) {
    const { modules, reserved } = placePatterns(size, version);
    placeData(modules, reserved, codewords, size);

    // 遮罩只套用在非保留區
    for (let r = 0; r < size; r += 1) {
      for (let c = 0; c < size; c += 1) {
        if (!reserved[r][c] && MASKS[maskIndex](r, c)) modules[r][c] ^= 1;
      }
    }
    applyFormat(modules, size, maskIndex);

    const score = penalty(modules, size);
    if (!best || score < best.score) best = { score, modules, size };
  }
  return { size: best.size, modules: best.modules.map((row) => row.map((v) => v === 1)) };
}

/**
 * 產生 QR 的 SVG。scale 是每個模組幾個像素，quiet 是四周留白的模組數。
 */
export function qrSvg(text, { scale = 6, quiet = 4 } = {}) {
  const { size, modules } = encodeQr(text);
  const total = (size + quiet * 2) * scale;

  let path = '';
  for (let r = 0; r < size; r += 1) {
    for (let c = 0; c < size; c += 1) {
      if (modules[r][c]) {
        path += `M${(c + quiet) * scale} ${(r + quiet) * scale}h${scale}v${scale}h-${scale}z`;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="${total}" `
    + `viewBox="0 0 ${total} ${total}" role="img" aria-label="簽到 QR Code">`
    + `<rect width="${total}" height="${total}" fill="#fff"/>`
    + `<path d="${path}" fill="#000"/></svg>`;
}
