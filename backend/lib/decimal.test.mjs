import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  absDecimal,
  addDecimals,
  compareDecimals,
  mulDecimals,
  negateDecimal,
  subDecimals,
} from './decimal.mjs';

test('exact decimal arithmetic avoids floating point drift', () => {
  assert.equal(addDecimals('0.1', '0.2'), '0.3');
  assert.equal(subDecimals('5', '1.25'), '3.75');
  assert.equal(subDecimals('5', '8'), '-3');
  assert.equal(mulDecimals('2.5', '4500.20'), '11250.5');
  assert.equal(compareDecimals('10', '9.9999'), 1);
  assert.equal(compareDecimals('5.00', '5'), 0);
  assert.equal(negateDecimal('5.50'), '-5.5');
  assert.equal(negateDecimal('0.00'), '0');
  assert.equal(absDecimal('-7.25'), '7.25');
});
