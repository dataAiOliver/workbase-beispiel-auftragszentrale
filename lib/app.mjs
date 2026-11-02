// HTTP-Anwendung der Auftragszentrale (node:http, ohne Framework).
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ROOT, runtime } from './runtime.mjs';
import { log, traceFromHeaders } from './log.mjs';
import { assertConfig, loadConfig } from './config.mjs';
import { createPool, migrate } from './db.mjs';
import { createStorage } from './storage.mjs';
import { findOrderByNumber, getOrder, listOrders, listProducts, orderStats } from './orders.mjs';
import { invoiceKey } from './invoice.mjs';
import { handlePaymentWebhook, WebhookError } from './webhook.mjs';

const PUBLIC_DIR = path.join(ROOT, 'public');
const MAX_BODY = 256 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

class HttpError extends Error {
  constructor(status, message, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new HttpError(413, 'Anfrage zu groß.', 'too_large');
    chunks.push(chunk);
  }
  try {
    return size ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
  } catch {
    throw new HttpError(400, 'Ungültiges JSON.', 'invalid_json');
  }
}

async function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    res.end(req.method === 'HEAD' ? undefined : body);
    return true;
  } catch {
    return false;
  }
}

export async function createApp(config = loadConfig()) {
  assertConfig(config);
  const pool = createPool(config.databaseUrl);
  pool.on('error', (err) => log({ severity: 'error', event: 'db.pool', outcome: 'error', message: 'Datenbankverbindung verloren', error: err }));
  const storage = createStorage(config.s3);
  const deps = { pool, storage };

  const started = performance.now();
  const applied = await migrate(pool);
  await storage.ensureBucket();
  log({
    event: 'app.migrate',
    duration_ms: Math.round(performance.now() - started),
    message: applied.length ? `Migrationen angewendet: ${applied.join(', ')}` : 'Schema aktuell',
    attrs: { applied },
  });

  async function route(req, res, url, ctx) {
    const { pathname } = url;
    const method = req.method;

    if (pathname === '/__health' && method === 'GET') {
      ctx.quiet = true;
      return sendJson(res, 200, { ok: true, ...runtime });
    }
    if (pathname === '/__workbase/telemetry' && method === 'POST') {
      ctx.quiet = true;
      req.resume();
      res.writeHead(204);
      return res.end();
    }
    if (pathname === '/api/meta' && method === 'GET') {
      return sendJson(res, 200, {
        ...runtime,
        paymentProviderUrl: config.paymentProviderUrl,
        invoiceBucket: storage.bucket,
      });
    }
    if (pathname === '/api/stats' && method === 'GET') {
      return sendJson(res, 200, await orderStats(pool));
    }
    if (pathname === '/api/products' && method === 'GET') {
      return sendJson(res, 200, { products: await listProducts(pool) });
    }
    if (pathname === '/api/orders' && method === 'GET') {
      const p = url.searchParams;
      return sendJson(res, 200, await listOrders(pool, {
        status: p.get('status'),
        q: p.get('q'),
        limit: p.get('limit'),
        offset: p.get('offset'),
      }));
    }
    const orderMatch = /^\/api\/orders\/(\d+)$/.exec(pathname);
    if (orderMatch && method === 'GET') {
      const order = await getOrder(pool, Number(orderMatch[1]));
      if (!order) throw new HttpError(404, 'Bestellung nicht gefunden.', 'not_found');
      return sendJson(res, 200, order);
    }
    const invoiceMatch = /^\/api\/invoices\/([A-Za-z0-9-]+)$/.exec(pathname);
    if (invoiceMatch && method === 'GET') {
      const order = await findOrderByNumber(pool, invoiceMatch[1]);
      if (!order) throw new HttpError(404, 'Bestellung nicht gefunden.', 'not_found');
      const key = invoiceKey(order);
      const invoice = await storage.getJson(key);
      ctx.attrs.invoice_key = key;
      if (!invoice) throw new HttpError(404, 'Keine Rechnung im Archiv.', 'invoice_missing');
      return sendJson(res, 200, { key, invoice });
    }
    if (pathname === '/api/webhooks/payment' && method === 'POST') {
      const event = await readJson(req);
      ctx.attrs.event_id = typeof event.event_id === 'string' ? event.event_id : null;
      const result = await handlePaymentWebhook(deps, event, { traceId: ctx.traceId });
      ctx.attrs.result = result.body.status;
      return sendJson(res, result.httpStatus, result.body);
    }
    if ((method === 'GET' || method === 'HEAD') && !pathname.startsWith('/api/')) {
      if (await serveStatic(req, res, pathname)) {
        ctx.quiet = true;
        return;
      }
    }
    throw new HttpError(404, 'Nicht gefunden.', 'not_found');
  }

  const server = http.createServer(async (req, res) => {
    const t0 = performance.now();
    const traceId = traceFromHeaders(req.headers);
    const url = new URL(req.url ?? '/', 'http://localhost');
    const ctx = { traceId, attrs: {}, quiet: false };
    res.setHeader('x-trace-id', traceId);
    let error = null;
    try {
      await route(req, res, url, ctx);
    } catch (err) {
      error = err;
      if (err instanceof HttpError || err instanceof WebhookError) {
        sendJson(res, err.status, { error: err.code, message: err.message });
      } else {
        sendJson(res, 500, { error: 'internal', message: 'Interner Fehler.' });
      }
    } finally {
      const status = res.statusCode;
      if (!ctx.quiet || status >= 400) {
        log({
          severity: status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info',
          event: 'http.request',
          outcome: status >= 400 ? 'error' : 'ok',
          duration_ms: Math.round(performance.now() - t0),
          trace_id: traceId,
          message: `${req.method} ${url.pathname}`,
          error: status >= 500 ? error : null,
          attrs: { route: url.pathname.replace(/\/\d+$/, '/:id'), method: req.method, status, ...ctx.attrs },
        });
      }
    }
  });

  return {
    server,
    pool,
    storage,
    config,
    listen(port = config.port, host = config.host) {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => resolve(server.address()));
      });
    },
    async close() {
      const closed = new Promise((resolve) => server.close(() => resolve()));
      server.closeAllConnections?.();
      await closed;
      await pool.end();
      storage.destroy();
    },
  };
}
