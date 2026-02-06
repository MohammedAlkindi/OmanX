import { createApp } from './app.js';
import { env } from './src/config/env.js';

const app = createApp();

app.listen(env.port, () => {
  console.log(`OmanX listening on port ${env.port}`);
});
