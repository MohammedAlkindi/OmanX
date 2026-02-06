// localResponder.js — deterministic local fallback responses

/**
 * Generate a safe local response when upstream model is unavailable.
 * @param {{lane:'strict'|'normal', message:string, kbResults?:Array<{id:string,doc?:any,score?:number}>}} params
 * @returns {string}
 */
export function generateLocalResponse({ lane = 'normal', message = '', kbResults = [] } = {}) {
  const cleanMessage = String(message || '').trim();

  if (lane === 'strict') {
    const refs = (Array.isArray(kbResults) ? kbResults : [])
      .slice(0, 3)
      .map((r) => r?.id)
      .filter(Boolean);

    if (!refs.length) {
      return [
        '🔒 I cannot provide case-specific compliance guidance right now because the official assistant is temporarily unavailable.',
        'Please contact your Designated School Official (DSO) or international student office before taking action.',
        'If this is urgent (status, visa, work authorization, legal, or medical), seek live official support immediately.',
      ].join(' ');
    }

    return [
      '🔒 I am in compliance fallback mode.',
      `I found relevant official knowledge-base entries: ${refs.join(', ')}.`,
      'Please verify details with your DSO/international office before acting, since live model generation is currently unavailable.',
      cleanMessage ? `Your question received: "${cleanMessage.slice(0, 300)}".` : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  // Normal/community mode fallback
  return [
    'I am temporarily in local fallback mode, so my response may be limited.',
    'For day-to-day topics, try asking in a shorter and more specific way (city, budget, preference, timeframe).',
    'For official or high-stakes questions, switch to official guidance and confirm with your DSO.',
  ].join(' ');
}
