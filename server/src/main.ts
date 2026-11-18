import { createApp } from './app';
import { config } from './config';

const app = await createApp(config);
const port = await app.listen();
console.log(`Aetherion server listening on http://${config.host}:${port}`);

let closing = false;
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    if (closing) return;
    closing = true;
    console.log('shutting down: saving players...');
    await app.close().catch((e) => console.error(e));
    process.exit(0);
  });
}
