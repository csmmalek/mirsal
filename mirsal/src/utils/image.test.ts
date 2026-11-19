import test from 'node:test';
import assert from 'node:assert/strict';
import { centerSquare } from './image';

test('centerSquare crops the longer side evenly', () => {
  assert.deepEqual(centerSquare(1000, 600), { sx: 200, sy: 0, side: 600 });
  assert.deepEqual(centerSquare(600, 1000), { sx: 0, sy: 200, side: 600 });
  assert.deepEqual(centerSquare(500, 500), { sx: 0, sy: 0, side: 500 });
});

test('centerSquare rejects empty images', () => {
  assert.equal(centerSquare(0, 400), null);
  assert.equal(centerSquare(400, 0), null);
});
