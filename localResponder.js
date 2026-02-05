function extractField(doc, keys) {
  for (const key of keys) {
    if (doc && typeof doc[key] === 'string' && doc[key].trim()) return doc[key].trim();
  }
  return null;
}

function stringifyDocPreview(doc) {
  if (!doc || typeof doc !== 'object') return null;
  const title = extractField(doc, ['title', 'name', 'topic']);
  const summary = extractField(doc, ['summary', 'guidance', 'description']);
  const steps = Array.isArray(doc.steps) ? doc.steps.filter(Boolean).slice(0, 2) : [];

  const lines = [];
  if (title) lines.push(title);
  if (summary) lines.push(summary);
  if (steps.length) lines.push(`Key steps: ${steps.join('; ')}`);

  return lines.join(' — ') || JSON.stringify(doc).slice(0, 220);
}

export function generateLocalResponse({ lane, message, kbResults = [] }) {
  const safeMessage = (message || '').trim();
  if (!safeMessage) {
    return "Please share your question and I'll do my best to help.";
  }

  if (lane === 'normal') {
    return [
      `Here is a practical starting point for: "${safeMessage}".`,
      '1) Start with your university student portal and campus services page.',
      '2) Ask your student community groups for local recommendations.',
      '3) If the issue affects legal status, scholarship rules, or health coverage, escalate to your DSO or sponsor office immediately.',
      '(Source: OmanX local fallback guidance.)',
    ].join('\n');
  }

  if (!kbResults.length) {
    return [
      '🔒 I could not find a matching official entry in the current OmanX knowledge base.',
      'Please contact your Designated School Official (DSO) or your international student office before taking action.',
      'If urgent, gather your documents and ask for written confirmation of next steps.',
    ].join(' ');
  }

  const top = kbResults.slice(0, 3);
  const actionLines = top.map((item, index) => {
    const preview = stringifyDocPreview(item.doc);
    return `${index + 1}. ${preview} [KB: ${item.id}]`;
  });

  return [
    '🔒 Strict guidance mode (local fallback):',
    ...actionLines,
    'Always verify final decisions with your DSO/scholarship authority before acting.',
  ].join('\n');
}
