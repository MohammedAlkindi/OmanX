// Local fallback responder implementation
export async function respondWithLocal({ lane, knowledge = { generalGuidance: [], strictGuidance: [], references: [] }, disclaimers = { general: '', strict: '' }, prompt = '' } = {}) {
  // Minimal, safe fallback used when the upstream model or KB is unavailable.
  // Returns an object with a `text` property (matching upstream responder shape).

  // If we have strict guidance entries, paraphrase them simply.
  if (lane === 'strict' && Array.isArray(knowledge.strictGuidance) && knowledge.strictGuidance.length) {
    const summary = knowledge.strictGuidance
      .slice(0, 3)
      .map((s, i) => `${i + 1}. ${typeof s === 'string' ? s : JSON.stringify(s)}`)
      .join('\n');

    return {
      text: `I couldn't reach the main model, so here's guidance from the local knowledge I have:\n\n${summary}`,
      degraded: true,
      source: 'local-kb',
    };
  }

  // Generic safe fallback when no KB is available.
  return {
    text: "I couldn't generate a response right now.",
    degraded: true,
    reason: 'fallback_no_kb_or_model',
  };
}

export async function generateLocalResponse({ lane, message, kbResults = [] } = {}) {
  const res = await respondWithLocal({ lane, knowledge: { generalGuidance: [], strictGuidance: kbResults || [], references: [] }, disclaimers: { general: '', strict: '' }, prompt: message });
  if (res && typeof res === 'object') return res.text || JSON.stringify(res);
  return String(res);
}

export { respondWithLocal };
