import test from 'node:test';
import assert from 'node:assert/strict';

import { routeQuery, searchKnowledge } from './router.js';

test('routeQuery returns strict lane for compliance terms', () => {
  const result = routeQuery('Can I work off-campus on F-1 during my first semester?');

  assert.equal(result.lane, 'strict');
  assert.ok(result.matches.includes('f-1'));
  assert.ok(result.matches.includes('off-campus'));
  assert.ok(result.confidence > 0);
});

test('routeQuery returns normal lane for lifestyle queries', () => {
  const result = routeQuery('Recommend a good coffee and brunch place near campus.');

  assert.equal(result.lane, 'normal');
  assert.ok(result.matches.includes('coffee'));
  assert.ok(result.matches.includes('brunch'));
});

test('routeQuery defaults ambiguous queries to strict lane', () => {
  const result = routeQuery('Can you help me with this?');

  assert.equal(result.lane, 'strict');
  assert.equal(result.confidence, 0.3);
});

test('searchKnowledge scores and sorts results for array structure', () => {
  const kb = {
    documents: [
      {
        id: 'doc-a',
        title: 'F-1 Work Authorization',
        summary: 'Rules for on-campus work',
      },
      {
        id: 'doc-b',
        title: 'Campus Dining',
        summary: 'Meal plans and hours',
      },
    ],
  };

  const results = searchKnowledge(kb, 'I need F-1 work authorization details.');

  assert.ok(results.length >= 1);
  assert.equal(results[0].id, 'doc-a');
  assert.ok(results[0].score > 0);
});

test('searchKnowledge works with legacy object structure', () => {
  const kb = {
    metadata: { version: '1' },
    visaPolicy: {
      topic: 'visa and sevis guidance',
    },
    housing: {
      topic: 'rent and lease basics',
    },
  };

  const results = searchKnowledge(kb, 'I have a visa and SEVIS question.');

  assert.ok(results.some((item) => item.id === 'visaPolicy'));
});
