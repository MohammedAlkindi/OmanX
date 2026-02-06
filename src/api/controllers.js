import { runEngine } from '../core/engine.js';

export async function healthController(req, res) {
  res.json({ status: 'ok', service: 'omanx' });
}

export async function chatController(req, res) {
  const result = await runEngine({
    message: req.body?.message,
    mode: req.body?.mode || 'local',
  });

  if (!result.ok) {
    return res.status(400).json(result);
  }

  return res.json(result);
}

export async function adminPolicyController(req, res) {
  const probe = await runEngine({ message: req.body?.message || 'policy health check' });
  res.json({ ok: true, probe });
}
