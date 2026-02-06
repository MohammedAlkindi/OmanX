export function labelRisk({ lane, matches = [] }) {
  if (lane === 'strict') {
    return matches.length >= 2 ? 'high' : 'medium';
  }
  return 'low';
}
