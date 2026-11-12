import { createServer } from './app.mjs';
import { createDetector } from './detector.mjs';
try {
  const detect = await createDetector();
  const server = createServer({detect});
  server.on('error', () => { process.stderr.write('SERVER_UNAVAILABLE\n'); process.exit(1); });
  server.listen(Number(process.env.PORT ?? 8000), process.env.BIND_HOST ?? '127.0.0.1');
  process.once('SIGTERM', () => server.close(() => process.exit(0)));
  process.once('SIGINT', () => server.close(() => process.exit(0)));
} catch { process.stderr.write('STARTUP_FAILED\n'); process.exit(1); }
