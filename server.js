import app from './app.server.js';

const PORT = Number(process.env.PORT || 3000);

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OmanX server listening on port ${PORT}`);
});
