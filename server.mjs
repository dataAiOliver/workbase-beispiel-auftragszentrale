// Nordwerk Auftragszentrale – Start: node server.mjs
import { createApp } from './lib/app.mjs';
import { loadConfig } from './lib/config.mjs';
import { log } from './lib/log.mjs';
import { runtime } from './lib/runtime.mjs';

const config = loadConfig();
if (!Number.isInteger(config.port)) {
  log({ severity: 'error', event: 'app.start', outcome: 'error', message: 'PORT ist nicht gesetzt.' });
  process.exit(1);
}

let app;
try {
  app = await createApp(config);
  await app.listen(config.port, config.host);
} catch (err) {
  log({ severity: 'error', event: 'app.start', outcome: 'error', message: 'Start fehlgeschlagen', error: err });
  process.exit(1);
}

log({
  event: 'app.start',
  message: `Nordwerk Auftragszentrale läuft auf http://${config.host}:${config.port}`,
  attrs: { port: config.port, host: config.host, stage: runtime.stage, commit: runtime.commit, bucket: config.s3.bucket },
});

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(0), 3000).unref();
    await app.close().catch(() => {});
    process.exit(0);
  });
}
