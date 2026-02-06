import { env } from '../config/env.js';

export function requireAdmin(req, res, next) {
  const token = req.get('x-admin-token');
  if (token !== env.adminToken) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  return next();
}
