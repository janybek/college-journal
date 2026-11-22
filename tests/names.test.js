import test from 'node:test';
import assert from 'node:assert/strict';
import { compareNames } from '../core/names.js';

test('alphabet: Kyrgyz letters, case-insensitive, signs first', () => {
  const sorted = ['Яковлев', 'өмүров', 'Орозов', 'Ёлкин', 'Ежов', 'Жумабаев', 'Үсөнов', 'Усенов', 'Ңуров', 'Нуров', 'Asanov', 'асанов'].sort(compareNames);
  assert.deepEqual(sorted, ['Asanov', 'асанов', 'Ежов', 'Ёлкин', 'Жумабаев', 'Нуров', 'Ңуров', 'Орозов', 'өмүров', 'Усенов', 'Үсөнов', 'Яковлев']);
});

test('stable order, edges ignored, prefix first', () => {
  assert.equal(compareNames('Исаев', 'исаев') !== 0, true);
  assert.equal(compareNames(' Исаев ', 'Исаев'), 0);
  assert.equal(compareNames('Исаев', 'Исаева'), -1);
  assert.equal(compareNames('Исаева', 'Исаев'), 1);
  assert.equal(compareNames('Ан-Бо', 'АнАБ'), -1);
});
