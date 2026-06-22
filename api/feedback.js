// api/feedback.js — OmanX feedback collection endpoint

export default function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { messageId, chatId, sessionId, rating, model, compliance } = req.body || {};

  if (rating !== 'up' && rating !== 'down') {
    return res.status(400).json({ error: 'rating must be "up" or "down"' });
  }

  const safe = {
    messageId: typeof messageId === 'string' ? messageId.slice(0, 64) : null,
    chatId: typeof chatId === 'string' ? chatId.slice(0, 64) : null,
    sessionId: typeof sessionId === 'string' ? sessionId.slice(0, 64).replace(/[^a-z0-9\-]/g, '') : 'unknown',
    rating,
    model: typeof model === 'string' ? model.slice(0, 64) : null,
    compliance: compliance === true,
    timestamp: new Date().toISOString(),
  };

  console.log('[OmanX] feedback', safe);

  return res.status(200).json({ ok: true });
}
