import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deliver, invoicesForPayment, ordersForPayment, paymentEvent, startApp } from './helpers.mjs';

describe('Zahlungs-Webhook', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(async () => {
    await app?.close();
  });

  test('Einfache Zustellung legt Bestellung, Positionen, Zahlung und Rechnung an', async () => {
    const since = Date.now();
    const event = paymentEvent();
    const res = await deliver(app, event);
    assert.equal(res.status, 201);
    assert.equal(res.body.status, 'created');
    assert.match(res.body.order_number, /^NW-\d+$/);

    const orders = await ordersForPayment(app, event.payment_id);
    assert.equal(orders.length, 1);
    assert.equal(orders[0].total_cents, 16880);
    assert.equal(orders[0].status, 'bezahlt');

    const detail = await (await fetch(`${app.baseUrl}/api/orders/${orders[0].id}`)).json();
    assert.equal(detail.items.length, 2);
    assert.equal(detail.payments.length, 1);
    assert.equal(detail.payments[0].event_id, event.event_id);
    assert.equal(detail.customer.name, 'Testkundin Möwe');

    const invoices = await invoicesForPayment(app, event.payment_id, since);
    assert.equal(invoices.length, 1);
    assert.equal(invoices[0].key, detail.invoice_key);
    assert.equal(invoices[0].doc.total_cents, 16880);

    const archived = await (await fetch(`${app.baseUrl}/api/invoices/${orders[0].order_number}`)).json();
    assert.equal(archived.invoice.order_number, orders[0].order_number);
  });

  test('Doppelte Zustellung erzeugt genau eine Bestellung und eine Rechnung', async () => {
    const since = Date.now();
    const event = paymentEvent();

    // PayNord stellt nach Zeitüberschreitung parallel erneut zu …
    const concurrent = await Promise.all([deliver(app, event), deliver(app, event)]);
    // … und später noch einmal.
    const late = await deliver(app, event);

    for (const res of [...concurrent, late]) {
      assert.ok(res.status === 200 || res.status === 201, `unerwarteter Status ${res.status}`);
    }

    const orders = await ordersForPayment(app, event.payment_id);
    const invoices = await invoicesForPayment(app, event.payment_id, since);
    assert.equal(orders.length, 1, `erwartet 1 Bestellung für ${event.payment_id}, gefunden ${orders.length} (${orders.map((o) => o.order_number).join(', ')})`);
    assert.equal(invoices.length, 1, `erwartet 1 Rechnung im Archiv, gefunden ${invoices.length} (${invoices.map((i) => i.key).join(', ')})`);

    const created = [...concurrent, late].filter((r) => r.body.status === 'created');
    assert.equal(created.length, 1, 'genau eine Zustellung darf eine Bestellung anlegen');

    const ids = new Set([...concurrent, late].map((r) => r.body.order_id));
    assert.deepEqual([...ids], [orders[0].id], 'alle Zustellungen verweisen auf dieselbe Bestellung');
  });

  test('Unvollständiges Ereignis wird mit 422 abgelehnt', async () => {
    const res = await deliver(app, paymentEvent({ items: [] }));
    assert.equal(res.status, 422);
    assert.equal(res.body.error, 'invalid_event');
  });
});
