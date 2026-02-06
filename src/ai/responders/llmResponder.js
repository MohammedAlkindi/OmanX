export async function respondWithLlm({ prompt, lane }) {
  return {
    text: `LLM responder placeholder (${lane}).\n${prompt}`,
    disclaimer: 'Generated response should be reviewed in production.',
    refs: [],
  };
}
