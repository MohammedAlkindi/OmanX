import test from 'node:test';
import assert from 'node:assert/strict';
import { runEngine } from '../core/engine.js';

test('runEngine returns strict answer for immigration question', async () => {
  const result = await runEngine({ message: 'What are CPT rules?', mode: 'local' });
  assert.equal(result.ok, true);
  assert.equal(result.lane, 'strict');
  assert.equal(result.risk, 'medium');
  assert.ok(result.answer.text.length > 0);
});

test('runEngine validates payload', async () => {
  const result = await runEngine({ message: '' });
  assert.equal(result.ok, false);
});
