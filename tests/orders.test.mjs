import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { deliver, paymentEvent, startApp } from './helpers.mjs';

describe('Bestell-API', () => {
  let app;
  before(async () => {
    app = await startApp();
  });
  after(async () => {
    await app?.close();
  });

  test('Liste filtert nach Suchbegriff und Status', async () => {
    const event = paymentEvent();
    const created = await deliver(app, event);
    assert.equal(created.status, 201);

    const byNumber = await (await fetch(`${app.baseUrl}/api/orders?q=${created.body.order_number}`)).json();
    assert.equal(byNumber.total, 1);
    assert.equal(byNumber.orders[0].order_number, created.body.order_number);
    assert.equal(byNumber.orders[0].item_count, 3);

    const byPayment = await (await fetch(`${app.baseUrl}/api/orders?q=${event.payment_id}&status=bezahlt`)).json();
    assert.equal(byPayment.total, 1);
    const wrongStatus = await (await fetch(`${app.baseUrl}/api/orders?q=${event.payment_id}&status=erstattet`)).json();
    assert.equal(wrongStatus.total, 0);
  });

  test('Fehlende Rechnung und unbekannte Bestellung liefern 404', async () => {
    const missing = await fetch(`${app.baseUrl}/api/invoices/NW-0`);
    assert.equal(missing.status, 404);
    const unknown = await fetch(`${app.baseUrl}/api/orders/999999999`);
    assert.equal(unknown.status, 404);
    const health = await (await fetch(`${app.baseUrl}/__health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.project, process.env.WORKBASE_PROJECT || 'nordwerk-orders');
  });
});
