const strictKeywords = [
  'visa', 'immigration', 'sevis', 'opt', 'cpt', 'uscis', 'deport', 'tax', 'legal', 'compliance',
];

export function detectLane(message = '') {
  const normalized = String(message).toLowerCase();
  const matches = strictKeywords.filter((word) => normalized.includes(word));
  return {
    lane: matches.length ? 'strict' : 'normal',
    matches,
  };
}

export function getPolicyGuidance(lane) {
  if (lane === 'strict') {
    return 'Verified knowledge only. If unsure, escalate to official advisors.';
  }
  return 'General guidance is allowed with practical, low-risk suggestions.';
}
