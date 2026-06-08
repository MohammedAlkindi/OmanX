// Vercel Web Analytics initialization
// Using the inject method from @vercel/analytics
import { inject } from 'https://cdn.jsdelivr.net/npm/@vercel/analytics@2/dist/index.mjs';

// Initialize analytics with auto mode detection
inject({
  mode: 'auto',
  debug: false,
});
