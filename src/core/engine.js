import knowledge from '../data/knowledge.json' with { type: 'json' };
import sources from '../data/sources.json' with { type: 'json' };
import disclaimers from '../data/disclaimers.json' with { type: 'json' };
import { detectLane, getPolicyGuidance } from './policy.js';
import { validateMessage } from './validator.js';
import { labelRisk } from './riskLabeler.js';
import { buildPrompt } from '../ai/prompts.js';
import { respondWithLocal } from '../ai/responders/localResponder.js';
import { respondWithLlm } from '../ai/responders/llmResponder.js';

export async function runEngine({ message, mode = 'local' }) {
  const validation = validateMessage(message);
  if (!validation.valid) {
    return {
      ok: false,
      error: validation.reason,
    };
  }

  const policy = detectLane(validation.message);
  const risk = labelRisk(policy);
  const prompt = buildPrompt({
    message: validation.message,
    lane: policy.lane,
    policyText: getPolicyGuidance(policy.lane),
  });

  const responder = mode === 'llm' ? respondWithLlm : respondWithLocal;
  const answer = await responder({
    prompt,
    lane: policy.lane,
    knowledge,
    sources,
    disclaimers,
  });

  return {
    ok: true,
    lane: policy.lane,
    risk,
    matches: policy.matches,
    answer,
  };
}
