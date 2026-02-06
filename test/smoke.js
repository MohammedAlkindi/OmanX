import { spawn } from 'child_process';

const PORT = process.env.PORT || 3001;
const SERVER_URL = `http://localhost:${PORT}`;

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

(async () => {
  console.log('Starting smoke test...');

  const server = spawn(process.execPath, ['server.js'], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  try {
    // wait for /health to be OK
    const deadline = Date.now() + 15_000;
    let healthy = false;
    while (Date.now() < deadline) {
      try {
          const r = await fetch(`${SERVER_URL}/health`);
        if (r.ok) {
          healthy = true;
          break;
        }
      } catch (e) {
        // ignore
      }
      await sleep(500);
    }

    if (!healthy) throw new Error('Server did not become healthy in time');
    console.log('Server healthy. Running chat test...');

    const r2 = await fetch(`${SERVER_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'What are the steps to get OPT?' }),
    });

    if (!r2.ok) {
      const txt = await r2.text().catch(() => '');
      throw new Error(`Chat endpoint failed: ${r2.status} ${txt}`);
    }

    const payload = await r2.json();
    if (!payload || !payload.text) throw new Error('Chat returned no text');

    console.log('Chat returned text, kbRefs:', payload.kbRefs || []);
    console.log('Smoke test passed.');
  } catch (e) {
    console.error('Smoke test failed:', e?.message || String(e));
    process.exitCode = 2;
  } finally {
    try { server.kill(); } catch {}
  }
})();
