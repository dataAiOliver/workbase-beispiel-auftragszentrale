// Gemeinsame Hilfen für die DB-/S3-Tests. Echte Datenbank und echter Bucket aus der Umgebung.
import { randomBytes } from 'node:crypto';
import { GetObjectCommand, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { createApp } from '../lib/app.mjs';
import { loadConfig } from '../lib/config.mjs';

export async function startApp() {
  const app = await createApp(loadConfig());
  const { port } = await app.listen(0, '127.0.0.1');
  return { ...app, baseUrl: `http://127.0.0.1:${port}` };
}

export function uniqueId(prefix) {
  return `${prefix}_test_${Date.now().toString(36)}${randomBytes(5).toString('hex')}`;
}

export function paymentEvent(overrides = {}) {
  const tag = randomBytes(3).toString('hex');
  return {
    event_id: uniqueId('evt'),
    type: 'payment.succeeded',
    payment_id: uniqueId('pn'),
    amount_cents: 2 * 1990 + 12900,
    currency: 'EUR',
    customer: {
      name: 'Testkundin Möwe',
      email: `test.moewe.${tag}@example.invalid`,
      phone: '+49 40 555 0199',
      street: 'Kehrwieder 4',
      postcode: '20457',
      city: 'Hamburg',
      country: 'DE',
    },
    items: [
      { sku: 'NW-HD-GRIP', name: 'Arbeitshandschuhe „Grip“ (3er-Pack)', quantity: 2, unit_price_cents: 1990 },
      { sku: 'NW-JK-FJELL', name: 'Softshelljacke „Fjell“', quantity: 1, unit_price_cents: 12900 },
    ],
    ...overrides,
  };
}

export async function deliver(app, event) {
  const res = await fetch(`${app.baseUrl}/api/webhooks/payment`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(event),
  });
  return { status: res.status, body: await res.json() };
}

export async function ordersForPayment(app, paymentId) {
  const { rows } = await app.pool.query('select * from orders where payment_id = $1 order by id', [paymentId]);
  return rows;
}

/** Zählt alle Rechnungsobjekte im Archiv, die zu dieser Zahlung gehören (unabhängig vom Schlüssel). */
export async function invoicesForPayment(app, paymentId, since) {
  const found = [];
  let token;
  do {
    const page = await app.storage.client.send(
      new ListObjectsV2Command({ Bucket: app.storage.bucket, Prefix: 'invoices/', ContinuationToken: token }),
    );
    for (const obj of page.Contents ?? []) {
      if (since && obj.LastModified && obj.LastModified.getTime() < since - 5000) continue;
      const res = await app.storage.client.send(new GetObjectCommand({ Bucket: app.storage.bucket, Key: obj.Key }));
      const doc = JSON.parse(await res.Body.transformToString('utf8'));
      if (doc.payment_id === paymentId) found.push({ key: obj.Key, doc });
    }
    token = page.NextContinuationToken;
  } while (token);
  return found;
}
