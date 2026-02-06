export function buildPrompt({ message, lane, policyText }) {
  return [
    `Mode: ${lane}`,
    `Policy: ${policyText}`,
    `User message: ${message}`,
    'If the issue is high-stakes, recommend official channels.',
  ].join('\n');
}
