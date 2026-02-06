export async function respondWithLocal({ lane, knowledge, disclaimers }) {
  const intro = lane === 'strict'
    ? 'Compliance mode enabled. I will only provide verified guidance.'
    : 'Community mode enabled. I can share practical tips.';

  const guidance = lane === 'strict'
    ? knowledge.strictGuidance.join(' ')
    : knowledge.generalGuidance.join(' ');

  const disclaimer = lane === 'strict' ? disclaimers.strict : disclaimers.general;

  return {
    text: `${intro} ${guidance}`,
    disclaimer,
    refs: knowledge.references,
  };
}
