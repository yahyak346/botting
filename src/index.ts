import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from './engine.ts';
import { createApp } from './server.ts';
import { Store } from './store.ts';
import { webhook } from './validate.ts';

try {
  process.loadEnvFile();
} catch {
  // .env is optional
}

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const store = new Store(process.env.DATA_DIR ?? path.join(root, 'data'));
await store.load();

if (!store.data.settings.webhookUrl && process.env.DISCORD_WEBHOOK_URL) {
  store.data.settings.webhookUrl = webhook(process.env.DISCORD_WEBHOOK_URL, 'DISCORD_WEBHOOK_URL');
}

const engine = new Engine(store);
engine.on('event', (e) => console.log(`[${e.monitorName}] ${e.type}: ${e.title} - ${e.details.join(' | ')}`));
engine.sync();

const port = Number(process.env.PORT ?? 3001);
const server = createApp(engine);
server.listen(port, '127.0.0.1', () => {
  console.log(`Drop Monitor dashboard: http://localhost:${port}`);
  console.log(`${store.data.monitors.length} monitor(s) loaded`);
});

const shutdown = async () => {
  engine.stop();
  server.closeAllConnections();
  server.close();
  await store.save();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
