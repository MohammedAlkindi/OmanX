import test from 'node:test';
import assert from 'node:assert/strict';
import { validateMessage } from '../core/validator.js';

test('validateMessage accepts normal input', () => {
  const result = validateMessage('Hello');
  assert.equal(result.valid, true);
});

test('validateMessage rejects empty input', () => {
  const result = validateMessage('   ');
  assert.equal(result.valid, false);
});
