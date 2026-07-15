// server.js - Main entry point for OmanX Express server

import './config/env.js';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import chatHandler from './api/chat.js';
import healthHandler from './api/health.js';
import readyHandler from './api/ready.js';
import metricsHandler from './api/metrics.js';
import feedbackHandler from './api/feedback.js';
import usageHandler from './api/usage.js';
import chatsHandler from './api/chats.js';
import authConfigHandler from './api/auth/config.js';
import authSessionHandler from './api/auth/session.js';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT || 3000);

const app = express();
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROUTE_METHODS = new Map([
  ['/', new Set(['GET'])],
  ['/product', new Set(['GET'])],
  ['/workspace', new Set(['GET'])],
  ['/chat', new Set(['GET'])],
<<<<<<< HEAD
  ['/meet', new Set(['GET'])],
  ['/system', new Set(['GET'])],
=======
  ['/about', new Set(['GET'])],
>>>>>>> a036d86ba418cb7318b8b8d8d41d9a46b7af31b4
  ['/method', new Set(['GET'])],
  ['/vision', new Set(['GET'])],
  ['/contact', new Set(['GET'])],
  ['/examples', new Set(['GET'])],
  ['/collaboration', new Set(['GET'])],
  ['/dashboard', new Set(['GET'])],
  ['/api/chat', new Set(['POST'])],
  ['/api/chats', new Set(['GET', 'PUT', 'OPTIONS'])],
  ['/api/auth/config', new Set(['GET'])],
  ['/api/auth/session', new Set(['GET'])],
  ['/api/feedback', new Set(['POST'])],
  ['/api/usage', new Set(['GET'])],
  ['/api/health', new Set(['GET'])],
  ['/api/ready', new Set(['GET'])],
  ['/api/metrics', new Set(['GET'])],
]);

// Middleware
app.use(express.json({ limit: '8mb' }));

app.use((req, res, next) => {
  const allowedMethods = ROUTE_METHODS.get(req.path);
  if (!allowedMethods || allowedMethods.has(req.method)) {
    return next();
  }

  if (req.path.startsWith('/api/')) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  return res.status(405).sendFile(path.join(PUBLIC_DIR, '405.html'));
});

// API Routes
app.post('/api/chat', chatHandler);
app.options('/api/chats', chatsHandler);
app.get('/api/chats', chatsHandler);
app.put('/api/chats', chatsHandler);
app.get('/api/auth/config', authConfigHandler);
app.get('/api/auth/session', authSessionHandler);
app.post('/api/feedback', feedbackHandler);
app.get('/api/usage', usageHandler);
app.get('/api/health', healthHandler);
app.get('/api/ready', readyHandler);
app.get('/api/metrics', metricsHandler);
// Canonical redirects from file-based routes
app.get('/index.html', (req, res) => res.redirect(301, '/product'));
app.get('/product.html', (req, res) => res.redirect(301, '/product'));
app.get('/chat.html', (req, res) => res.redirect(301, '/'));
<<<<<<< HEAD
app.get('/meet.html', (req, res) => res.redirect(301, '/meet'));
app.get('/system.html', (req, res) => res.redirect(301, '/system'));
=======
app.get('/about.html', (req, res) => res.redirect(301, '/about'));
>>>>>>> a036d86ba418cb7318b8b8d8d41d9a46b7af31b4
app.get('/method.html', (req, res) => res.redirect(301, '/method'));
app.get('/vision.html', (req, res) => res.redirect(301, '/vision'));
app.get('/contact.html', (req, res) => res.redirect(301, '/contact'));
app.get('/examples.html', (req, res) => res.redirect(301, '/examples'));
app.get('/settings.html', (req, res) => res.redirect(301, '/'));
app.get('/collaboration.html', (req, res) => res.redirect(301, '/collaboration'));
<<<<<<< HEAD
app.get('/trust.html', (req, res) => res.redirect(301, '/system'));
=======
>>>>>>> a036d86ba418cb7318b8b8d8d41d9a46b7af31b4
app.get('/dashboard.html', (req, res) => res.redirect(301, '/dashboard'));

// Legacy pages merged into /about
app.get(['/system', '/system.html', '/trust', '/trust.html'], (req, res) => res.redirect(301, '/about'));

// Page routes
app.get('/', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'chat.html'));
});

app.get('/product', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

app.get(['/workspace', '/chat'], (req, res) => res.redirect(301, '/'));

<<<<<<< HEAD
app.get('/meet', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'meet.html'));
});

app.get('/system', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'system.html'));
=======
app.get('/about', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'about.html'));
>>>>>>> a036d86ba418cb7318b8b8d8d41d9a46b7af31b4
});

app.get('/method', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'method.html'));
});

app.get('/vision', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'vision.html'));
});

app.get('/contact', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'contact.html'));
});

app.get('/examples', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'examples.html'));
});

<<<<<<< HEAD
app.get('/trust', (req, res) => res.redirect(301, '/system'));

=======
>>>>>>> a036d86ba418cb7318b8b8d8d41d9a46b7af31b4
app.get('/settings', (req, res) => res.redirect(301, '/'));

app.get('/collaboration', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'collaboration.html'));
});

app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'dashboard.html'));
});

// Legacy redirects
app.get('/info', (req, res) => res.redirect(301, '/about'));

// Serve static files from public directory
app.use(express.static(PUBLIC_DIR));

// Fallback
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }
  return res.status(404).sendFile(path.join(PUBLIC_DIR, '404.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Internal server error' });
  }
  return res.status(500).sendFile(path.join(PUBLIC_DIR, '500.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OmanX running at http://localhost:${PORT}`);
  console.log('API endpoints available at:');
  console.log(`  - http://localhost:${PORT}/api/chat`);
  console.log(`  - http://localhost:${PORT}/api/usage`);
  console.log(`  - http://localhost:${PORT}/api/health`);
  console.log(`  - http://localhost:${PORT}/api/ready`);
  console.log(`  - http://localhost:${PORT}/api/metrics`);
});
