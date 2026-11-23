import test from 'node:test';
import assert from 'node:assert/strict';
import { formatBits, qrMatrix, rsRemainder, versionBits } from '../site/js/qr.js';

// Таблица уровня M из задания: [версия, ЕС на блок, блоки, всего кодов, остаточные биты, центры выравнивания]
const M = [
  [1, 10, [[1, 16]], 26, 0, []],
  [2, 16, [[1, 28]], 44, 7, [6, 18]],
  [3, 26, [[1, 44]], 70, 7, [6, 22]],
  [4, 18, [[2, 32]], 100, 7, [6, 26]],
  [5, 24, [[2, 43]], 134, 7, [6, 30]],
  [6, 16, [[4, 27]], 172, 7, [6, 34]],
  [7, 18, [[4, 31]], 196, 0, [6, 22, 38]],
  [8, 22, [[2, 38], [2, 39]], 242, 0, [6, 24, 42]],
  [9, 22, [[3, 36], [2, 37]], 292, 0, [6, 26, 46]],
  [10, 26, [[4, 43], [1, 44]], 346, 0, [6, 28, 50]],
];
const CAP = [14, 26, 42, 62, 84, 106, 122, 152, 180, 213];

// Служебные клетки, нарисованные заново по описанию стандарта (независимо от кодировщика).
function functionCells(version) {
  const size = 17 + 4 * version;
  const cells = new Set();
  const add = (r, c) => { if (r >= 0 && c >= 0 && r < size && c < size) cells.add(r * size + c); };
  for (const [r0, c0] of [[0, 0], [0, size - 8], [size - 8, 0]]) {
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) add(r0 + r, c0 + c);
  }
  for (let i = 0; i < size; i++) { add(6, i); add(i, 6); }
  const ctr = M[version - 1][5];
  for (const a of ctr) {
    for (const b of ctr) {
      const onFinder = (a === 6 && b === 6) || (a === 6 && b === ctr[ctr.length - 1]) || (a === ctr[ctr.length - 1] && b === 6);
      if (onFinder) continue;
      for (let r = -2; r <= 2; r++) for (let c = -2; c <= 2; c++) add(a + r, b + c);
    }
  }
  for (let i = 0; i < 9; i++) { add(i, 8); add(8, i); }
  for (let i = 0; i < 8; i++) { add(8, size - 1 - i); add(size - 1 - i, 8); }
  add(4 * version + 9, 8);
  if (version >= 7) {
    for (let i = 0; i < 6; i++) for (let j = 0; j < 3; j++) { add(i, size - 11 + j); add(size - 11 + j, i); }
  }
  return cells;
}

test('rsRemainder, formatBits, versionBits: values of the standard', () => {
  assert.deepEqual(rsRemainder([32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17], 10), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  assert.deepEqual([formatBits('M', 0), formatBits('L', 4), formatBits('M', 7), formatBits('H', 0)], [0b101010000010010, 0b110011000101111, 0b100101010100000, 0b001011010001001]);
  assert.deepEqual([versionBits(7), versionBits(8)], [0b000111110010010100, 0b001000010110111100]);
  assert.equal(versionBits(1), 0);
  assert.equal(versionBits(6), 0);
});

test('qrMatrix: the smallest version that fits, the limit of 213 bytes', () => {
  assert.deepEqual(['a'.repeat(14), 'a'.repeat(15), 'a'.repeat(84), 'a'.repeat(85), 'a'.repeat(213)].map((s) => qrMatrix(s).version), [1, 2, 5, 6, 10]);
  assert.throws(() => qrMatrix('a'.repeat(214)), /qr_too_long/);
  assert.equal(qrMatrix('я'.repeat(7)).version, 1); // 14 байт UTF-8
  CAP.forEach((n, i) => {
    assert.equal(qrMatrix('a'.repeat(n)).version, i + 1);
    if (i < 9) assert.equal(qrMatrix('a'.repeat(n + 1)).version, i + 2);
  });
});

const link = 'https://janybek.github.io/college-journal/#/q/p_k3m9x2q7/0123456789abcdef';

test('qrMatrix: the link of the projector screen, repeatable', () => {
  const m = qrMatrix(link);
  assert.equal(m.version <= 6, true);
  assert.equal(m.size, 17 + 4 * m.version);
  assert.equal(m.rows.length, m.size);
  assert.equal(m.rows.every((row) => row.length === m.size && row.every((v) => typeof v === 'boolean')), true);
  assert.deepEqual(qrMatrix(link), m);
});

test('qrMatrix: service patterns, for every version', () => {
  for (let v = 1; v <= 10; v++) {
    const m = qrMatrix('a'.repeat(CAP[v - 1]));
    const { rows, size } = m;
    // поисковые узоры: тёмная рамка, светлое кольцо, тёмный квадрат 3x3; вокруг светлый разделитель
    for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]]) {
      for (let r = 0; r < 7; r++) {
        for (let c = 0; c < 7; c++) {
          const ring = Math.max(Math.abs(r - 3), Math.abs(c - 3));
          assert.equal(rows[r0 + r][c0 + c], ring !== 2, `v${v} finder ${r0},${c0} at ${r},${c}`);
        }
      }
    }
    for (let i = 0; i < 8; i++) {
      assert.equal(rows[7][i] || rows[i][7], false);
      assert.equal(rows[7][size - 1 - i] || rows[i][size - 8], false);
      assert.equal(rows[size - 8][i] || rows[size - 1 - i][7], false);
    }
    // строка 6 и колонка 6 между узорами чередуются, начиная с тёмного
    for (let i = 8; i < size - 8; i++) {
      assert.equal(rows[6][i], i % 2 === 0);
      assert.equal(rows[i][6], i % 2 === 0);
    }
    // тёмный модуль
    assert.equal(rows[4 * v + 9][8], true);
    // выравнивающий узор в (size - 7, size - 7)
    if (v >= 2) {
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) assert.equal(rows[size - 7 + r][size - 7 + c], Math.max(Math.abs(r), Math.abs(c)) !== 1);
      }
    }
    // 18 бит версии в двух местах
    if (v >= 7) {
      const bits = versionBits(v);
      for (let i = 0; i < 18; i++) {
        const want = ((bits >>> i) & 1) === 1;
        assert.equal(rows[Math.floor(i / 3)][size - 11 + (i % 3)], want);
        assert.equal(rows[size - 11 + (i % 3)][Math.floor(i / 3)], want);
      }
    }
    // 15 бит формата, обе копии
    const want = formatBits('M', m.mask);
    const a = [[0, 8], [1, 8], [2, 8], [3, 8], [4, 8], [5, 8], [7, 8], [8, 8], [8, 7], [8, 5], [8, 4], [8, 3], [8, 2], [8, 1], [8, 0]];
    const b = [...Array.from({ length: 8 }, (_, i) => [8, size - 1 - i]), ...Array.from({ length: 7 }, (_, i) => [size - 7 + i, 8])];
    const read = (cells) => cells.reduce((acc, [r, c], i) => acc | ((rows[r][c] ? 1 : 0) << i), 0);
    assert.equal(read(a), want, `v${v} format copy 1`);
    assert.equal(read(b), want, `v${v} format copy 2`);
    // число модулей вне служебных узоров = всего кодов * 8 + остаточные биты
    const [, , , total, rest] = M[v - 1];
    assert.equal(size * size - functionCells(v).size, total * 8 + rest, `v${v} data modules`);
  }
});

// Обратный разбор матрицы по описанию стандарта: маска из бит формата, зигзаг, блоки, проверка кодов Рида — Соломона, текст.
function decode(m) {
  const { rows, size, version } = m;
  const fixed = functionCells(version);
  const [, ec, blocks, total] = M[version - 1];
  const expr = [(r, c) => (r + c) % 2, (r) => r % 2, (r, c) => c % 3, (r, c) => (r + c) % 3,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2, (r, c) => ((r * c) % 2) + ((r * c) % 3),
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2, (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2];
  const bits = [];
  for (let col = size - 1; col >= 1; col -= 2) {
    if (col === 6) col = 5;
    const up = ((col + 1) & 2) === 0;
    for (let s = 0; s < size; s++) {
      const r = up ? size - 1 - s : s;
      for (const c of [col, col - 1]) {
        if (!fixed.has(r * size + c)) bits.push(rows[r][c] !== (expr[m.mask](r, c) === 0) ? 1 : 0);
      }
    }
  }
  const cw = [];
  for (let i = 0; i < total; i++) cw.push(bits.slice(i * 8, i * 8 + 8).reduce((a, b) => (a << 1) | b, 0));
  const lens = blocks.flatMap(([n, len]) => Array(n).fill(len));
  const dBlocks = lens.map(() => []);
  const longest = Math.max(...lens);
  let p = 0;
  for (let i = 0; i < longest; i++) lens.forEach((len, k) => { if (i < len) dBlocks[k].push(cw[p++]); });
  const eBlocks = lens.map(() => []);
  for (let i = 0; i < ec; i++) lens.forEach((_, k) => eBlocks[k].push(cw[p++]));
  dBlocks.forEach((d, k) => assert.deepEqual(rsRemainder(d, ec), eBlocks[k]));
  const data = dBlocks.flat();
  const stream = data.map((b) => b.toString(2).padStart(8, '0')).join('');
  assert.equal(stream.slice(0, 4), '0100');
  const lenBits = version < 10 ? 8 : 16;
  const n = parseInt(stream.slice(4, 4 + lenBits), 2);
  const out = [];
  for (let i = 0; i < n; i++) out.push(parseInt(stream.slice(4 + lenBits + i * 8, 12 + lenBits + i * 8), 2));
  return new TextDecoder().decode(new Uint8Array(out));
}

test('qrMatrix: the matrix reads back to the same text (all versions, Latin and Cyrillic)', () => {
  const texts = [link, 'x', 'Журнал колледжа', ...CAP.map((n, i) => String.fromCharCode(97 + i).repeat(n))];
  for (const t of texts) assert.equal(decode(qrMatrix(t)), t);
  for (let n = 1; n <= 213; n += 7) {
    const t = Array.from({ length: n }, (_, i) => 'abcxyz09/#_-'[(i * 7 + n) % 12]).join('');
    assert.equal(decode(qrMatrix(t)), t);
  }
});
