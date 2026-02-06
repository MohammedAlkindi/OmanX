import test from 'node:test';
import assert from 'node:assert/strict';
import { detectLane } from '../core/policy.js';

test('detectLane selects strict for compliance keywords', () => {
  const result = detectLane('Can I start OPT without EAD?');
  assert.equal(result.lane, 'strict');
  assert.ok(result.matches.includes('opt'));
});

test('detectLane selects normal for non-risky topics', () => {
  const result = detectLane('Recommend cafes near campus');
  assert.equal(result.lane, 'normal');
});
