// Свой QR-кодировщик: режим «байты», уровень коррекции M, версии 1-10.
// Чистый алгоритм без DOM и библиотек: матрицу на canvas рисует экран проектора.

// Версия -> { ec: кодов коррекции на блок, blocks: [[число блоков, данных в блоке], ...], rest: остаточные биты, align: центры }
const TABLE_M = [
  null,
  { ec: 10, blocks: [[1, 16]], rest: 0, align: [] },
  { ec: 16, blocks: [[1, 28]], rest: 7, align: [6, 18] },
  { ec: 26, blocks: [[1, 44]], rest: 7, align: [6, 22] },
  { ec: 18, blocks: [[2, 32]], rest: 7, align: [6, 26] },
  { ec: 24, blocks: [[2, 43]], rest: 7, align: [6, 30] },
  { ec: 16, blocks: [[4, 27]], rest: 7, align: [6, 34] },
  { ec: 18, blocks: [[4, 31]], rest: 0, align: [6, 22, 38] },
  { ec: 22, blocks: [[2, 38], [2, 39]], rest: 0, align: [6, 24, 42] },
  { ec: 22, blocks: [[3, 36], [2, 37]], rest: 0, align: [6, 26, 46] },
  { ec: 26, blocks: [[4, 43], [1, 44]], rest: 0, align: [6, 28, 50] },
];
const MAX_VERSION = 10;
const ECC_BITS = { L: 1, M: 0, Q: 3, H: 2 };

// --- поле GF(256), многочлен 0x11d ---
const EXP = new Array(512);
const LOG = new Array(256);
(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
})();
const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

// Многочлен-делитель степени d без старшего коэффициента (он равен 1), старшие степени первыми.
function generator(d) {
  let g = [1];
  for (let i = 0; i < d; i++) {
    const next = new Array(g.length + 1).fill(0);
    for (let j = 0; j < g.length; j++) {
      next[j] ^= g[j];
      next[j + 1] ^= gfMul(g[j], EXP[i]);
    }
    g = next;
  }
  return g.slice(1);
}

export function rsRemainder(data, ecCount) {
  const gen = generator(ecCount);
  const rem = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift();
    rem.push(0);
    for (let i = 0; i < ecCount; i++) rem[i] ^= gfMul(gen[i], factor);
  }
  return rem;
}

// Остаток от деления (value << degree) на многочлен poly (степени degree).
function bchRemainder(value, poly, degree) {
  let rem = value << degree;
  for (let bit = 31 - Math.clz32(rem); bit >= degree; bit--) {
    if ((rem >>> bit) & 1) rem ^= poly << (bit - degree);
  }
  return rem;
}

export function formatBits(ecc, mask) {
  const data = (ECC_BITS[ecc] << 3) | mask;
  return (((data << 10) | bchRemainder(data, 0x537, 10)) ^ 0x5412);
}

export function versionBits(version) {
  if (version < 7) return 0;
  return (version << 12) | bchRemainder(version, 0x1f25, 12);
}

// --- данные ---
function dataCodewords(bytes, version) {
  const t = TABLE_M[version];
  const total = t.blocks.reduce((s, [n, len]) => s + n * len, 0);
  const bits = [];
  const put = (value, count) => { for (let i = count - 1; i >= 0; i--) bits.push((value >>> i) & 1); };
  put(0b0100, 4);
  put(bytes.length, version < 10 ? 8 : 16);
  for (const b of bytes) put(b, 8);
  put(0, Math.min(4, total * 8 - bits.length));
  while (bits.length % 8) bits.push(0);
  const out = [];
  for (let i = 0; i < bits.length; i += 8) {
    let v = 0;
    for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
    out.push(v);
  }
  for (let pad = 0; out.length < total; pad++) out.push(pad % 2 === 0 ? 0xec : 0x11);
  return out;
}

// Блоки данных и кодов коррекции, перемешанные по столбцам (короткие блоки первыми).
function interleave(data, version) {
  const t = TABLE_M[version];
  const blocks = [];
  let pos = 0;
  for (const [n, len] of t.blocks) {
    for (let i = 0; i < n; i++) {
      const d = data.slice(pos, pos + len);
      pos += len;
      blocks.push({ d, e: rsRemainder(d, t.ec) });
    }
  }
  const out = [];
  const longest = Math.max(...blocks.map((b) => b.d.length));
  for (let i = 0; i < longest; i++) for (const b of blocks) if (i < b.d.length) out.push(b.d[i]);
  for (let i = 0; i < t.ec; i++) for (const b of blocks) out.push(b.e[i]);
  return out;
}

// --- служебные узоры ---
function newGrid(size) {
  return Array.from({ length: size }, () => new Array(size).fill(false));
}

function drawFunctionPatterns(version, size, dark, fixed) {
  const set = (r, c, v) => { dark[r][c] = v; fixed[r][c] = true; };
  // поисковые узоры 7x7 с светлым разделителем (рамка 8x8)
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = r0 + dr;
        const c = c0 + dc;
        if (r < 0 || c < 0 || r >= size || c >= size) continue;
        const ring = Math.max(Math.abs(dr - 3), Math.abs(dc - 3));
        set(r, c, ring !== 2 && ring !== 4);
      }
    }
  }
  // полосы синхронизации
  for (let i = 8; i < size - 8; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // выравнивающие узоры 5x5
  const centers = TABLE_M[version].align;
  const last = centers.length - 1;
  centers.forEach((cr, i) => centers.forEach((cc, j) => {
    if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) set(cr + dr, cc + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
    }
  }));
  // места под биты формата (значения пишутся позже) и тёмный модуль
  for (let i = 0; i < 9; i++) { fixed[i][8] = true; fixed[8][i] = true; }
  for (let i = 0; i < 8; i++) { fixed[8][size - 1 - i] = true; fixed[size - 1 - i][8] = true; }
  set(4 * version + 9, 8, true);
  // биты версии
  if (version >= 7) {
    const bits = versionBits(version);
    for (let i = 0; i < 18; i++) {
      const v = ((bits >>> i) & 1) === 1;
      const a = Math.floor(i / 3);
      const b = size - 11 + (i % 3);
      set(a, b, v);
      set(b, a, v);
    }
  }
}

function drawFormat(mask, size, dark) {
  const bits = formatBits('M', mask);
  const bit = (i) => ((bits >>> i) & 1) === 1;
  for (let i = 0; i <= 5; i++) dark[i][8] = bit(i);
  dark[7][8] = bit(6);
  dark[8][8] = bit(7);
  dark[8][7] = bit(8);
  for (let i = 9; i < 15; i++) dark[8][14 - i] = bit(i);
  for (let i = 0; i < 8; i++) dark[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i++) dark[size - 15 + i][8] = bit(i);
}

// Зигзаг по двум столбцам справа налево, снизу вверх и обратно; столбец 6 пропускается.
function placeData(codewords, version, size, dark, fixed) {
  const total = codewords.length * 8;
  let n = 0;
  let free = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const up = ((right + 1) & 2) === 0;
    for (let step = 0; step < size; step++) {
      const r = up ? size - 1 - step : step;
      for (let k = 0; k < 2; k++) {
        const c = right - k;
        if (fixed[r][c]) continue;
        free++;
        if (n < total) dark[r][c] = ((codewords[n >> 3] >>> (7 - (n & 7))) & 1) === 1;
        n++;
      }
    }
  }
  if (free !== total + TABLE_M[version].rest) throw new Error('qr_layout');
}

// --- маски и штрафы ---
const MASKS = [
  (r, c) => (r + c) % 2,
  (r) => r % 2,
  (r, c) => c % 3,
  (r, c) => (r + c) % 3,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2,
  (r, c) => ((r * c) % 2) + ((r * c) % 3),
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2,
];

function penalty(g) {
  const size = g.length;
  let score = 0;
  const lines = [];
  for (let i = 0; i < size; i++) {
    lines.push(g[i]);
    lines.push(g.map((row) => row[i]));
  }
  const P1 = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0].map(Boolean);
  const P2 = [...P1].reverse();
  for (const line of lines) {
    // N1: серии одного цвета длиной 5 и больше
    let run = 1;
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    // N3: 1011101 с четырьмя светлыми с любой стороны
    for (let i = 0; i + 11 <= size; i++) {
      if (P1.every((v, k) => line[i + k] === v)) score += 40;
      if (P2.every((v, k) => line[i + k] === v)) score += 40;
    }
  }
  // N2: квадраты 2x2 одного цвета
  for (let r = 0; r + 1 < size; r++) {
    for (let c = 0; c + 1 < size; c++) {
      const v = g[r][c];
      if (g[r][c + 1] === v && g[r + 1][c] === v && g[r + 1][c + 1] === v) score += 3;
    }
  }
  // N4: отклонение доли тёмных от 50%, по 10 за каждые 5%
  let darkCount = 0;
  for (const row of g) for (const v of row) if (v) darkCount++;
  const cells = size * size;
  score += (Math.ceil(Math.abs(darkCount * 20 - cells * 10) / cells) - 1) * 10;
  return score;
}

export function qrMatrix(text) {
  const bytes = new TextEncoder().encode(String(text));
  let version = 0;
  for (let v = 1; v <= MAX_VERSION && !version; v++) {
    const t = TABLE_M[v];
    const data = t.blocks.reduce((s, [n, len]) => s + n * len, 0);
    if (4 + (v < 10 ? 8 : 16) + bytes.length * 8 <= data * 8) version = v;
  }
  if (!version) throw new Error('qr_too_long');
  const size = 17 + 4 * version;
  const base = newGrid(size);
  const fixed = newGrid(size);
  drawFunctionPatterns(version, size, base, fixed);
  placeData(interleave(dataCodewords(bytes, version), version), version, size, base, fixed);

  let best = null;
  for (let mask = 0; mask < 8; mask++) {
    const g = base.map((row) => row.slice());
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) if (!fixed[r][c] && MASKS[mask](r, c) === 0) g[r][c] = !g[r][c];
    }
    drawFormat(mask, size, g);
    const score = penalty(g);
    if (!best || score < best.score) best = { score, mask, rows: g };
  }
  return { version, size, mask: best.mask, rows: best.rows };
}
