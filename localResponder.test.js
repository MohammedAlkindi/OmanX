import test from 'node:test';
import assert from 'node:assert/strict';

import { generateLocalResponse } from './localResponder.js';

test('generateLocalResponse returns normal-lane actionable fallback', () => {
  const text = generateLocalResponse({
    lane: 'normal',
    message: 'best food near campus',
  });

  assert.match(text, /practical starting point/i);
  assert.match(text, /campus services/i);
});

test('generateLocalResponse returns strict escalation without KB matches', () => {
  const text = generateLocalResponse({
    lane: 'strict',
    message: 'Can I work off-campus?',
    kbResults: [],
  });

  assert.match(text, /could not find a matching official entry/i);
  assert.match(text, /designated school official/i);
});

test('generateLocalResponse includes KB IDs when matches exist', () => {
  const text = generateLocalResponse({
    lane: 'strict',
    message: 'Do I need my I-20?',
    kbResults: [
      {
        id: 'visa_docs_001',
        doc: {
          title: 'I-20 Carry Rule',
          summary: 'Carry your I-20 when traveling outside your local area.',
        },
      },
    ],
  });

  assert.match(text, /visa_docs_001/i);
  assert.match(text, /strict guidance mode/i);
});
