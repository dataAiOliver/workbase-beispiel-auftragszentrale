// Verarbeitung der Zahlungs-Webhooks von PayNord („payment.succeeded“).
import { withTransaction } from './db.mjs';
import { buildInvoice, invoiceKey, orderNumberFor } from './invoice.mjs';
import { log } from './log.mjs';

export class WebhookError extends Error {
  constructor(message, status = 422, code = 'invalid_event') {
    super(message);
    this.name = 'WebhookError';
    this.status = status;
    this.code = code;
  }
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new WebhookError(`Feld ${field} fehlt.`);
  return value.trim();
}

export function validateEvent(event) {
  if (!event || typeof event !== 'object') throw new WebhookError('Ereignis fehlt.');
  const eventId = requireString(event.event_id, 'event_id');
  const paymentId = requireString(event.payment_id, 'payment_id');
  const customer = event.customer ?? {};
  requireString(customer.name, 'customer.name');
  requireString(customer.email, 'customer.email');
  if (!Array.isArray(event.items) || event.items.length === 0) throw new WebhookError('Ereignis enthält keine Positionen.');
  for (const item of event.items) {
    requireString(item?.sku, 'items[].sku');
    if (!Number.isInteger(item.quantity) || item.quantity < 1) throw new WebhookError(`Ungültige Menge für ${item.sku}.`);
  }
  if (!Number.isInteger(event.amount_cents) || event.amount_cents <= 0) throw new WebhookError('amount_cents ist ungültig.');
  return { eventId, paymentId, currency: (event.currency || 'EUR').toUpperCase() };
}

async function upsertCustomer(client, customer) {
  const { rows: [existing] } = await client.query(
    'select * from customers where lower(email) = lower($1) order by id limit 1',
    [customer.email],
  );
  if (existing) return existing;
  const { rows: [{ id }] } = await client.query(`select nextval(pg_get_serial_sequence('customers', 'id')) as id`);
  const { rows: [created] } = await client.query(
    `insert into customers (id, customer_number, name, email, phone, street, postcode, city, country)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning *`,
    [
      id,
      `K-${String(200000 + id)}`,
      customer.name,
      customer.email,
      customer.phone ?? null,
      customer.street ?? null,
      customer.postcode ?? null,
      customer.city ?? null,
      (customer.country ?? 'DE').toUpperCase(),
    ],
  );
  return created;
}

async function resolveLines(client, items) {
  const skus = items.map((i) => i.sku);
  const { rows } = await client.query('select id, sku, name, price_cents from products where sku = any($1)', [skus]);
  const bySku = new Map(rows.map((r) => [r.sku, r]));
  return items.map((item) => {
    const product = bySku.get(item.sku);
    return {
      product_id: product?.id ?? null,
      sku: item.sku,
      name: product?.name ?? item.name ?? item.sku,
      quantity: item.quantity,
      unit_price_cents: Number.isInteger(item.unit_price_cents) ? item.unit_price_cents : product?.price_cents ?? 0,
    };
  });
}

async function insertOrder(client, { paymentId, eventId, currency, amount, customer, lines, receivedAt }) {
  const { rows: [{ id }] } = await client.query(`select nextval(pg_get_serial_sequence('orders', 'id')) as id`);
  const { rows: [order] } = await client.query(
    `insert into orders (id, order_number, customer_id, status, channel, payment_id, total_cents, currency, created_at)
     values ($1, $2, $3, 'bezahlt', 'webshop', $4, $5, $6, $7) returning *`,
    [id, orderNumberFor(id), customer.id, paymentId, amount, currency, receivedAt],
  );
  for (const line of lines) {
    await client.query(
      `insert into order_items (order_id, product_id, sku, name, quantity, unit_price_cents)
       values ($1, $2, $3, $4, $5, $6)`,
      [order.id, line.product_id, line.sku, line.name, line.quantity, line.unit_price_cents],
    );
  }
  await client.query(
    `insert into payments (order_id, provider, payment_id, event_id, amount_cents, currency, status, received_at)
     values ($1, 'paynord', $2, $3, $4, $5, 'succeeded', $6)`,
    [order.id, paymentId, eventId, amount, currency, receivedAt],
  );
  return order;
}

/**
 * Verbucht ein „payment.succeeded“-Ereignis: Kunde (falls neu), Bestellung, Positionen,
 * Zahlung – anschließend wird die Rechnung im Archiv abgelegt.
 */
export async function handlePaymentWebhook({ pool, storage }, event, { traceId } = {}) {
  if (event?.type !== 'payment.succeeded') {
    return { httpStatus: 202, body: { status: 'ignored', message: `Ereignistyp ${event?.type ?? '–'} wird nicht verarbeitet.` } };
  }
  const { eventId, paymentId, currency } = validateEvent(event);

  // PayNord stellt Ereignisse bei Zeitüberschreitung erneut zu – schon verbuchte überspringen.
  const { rows: seen } = await pool.query(
    `select p.order_id, o.order_number from payments p join orders o on o.id = p.order_id
      where p.event_id = $1 order by p.id limit 1`,
    [eventId],
  );
  if (seen.length) {
    log({
      event: 'webhook.payment',
      trace_id: traceId,
      message: 'Ereignis bereits verbucht',
      attrs: { event_id: eventId, order_id: seen[0].order_id, result: 'already_processed' },
    });
    return {
      httpStatus: 200,
      body: { status: 'already_processed', order_id: seen[0].order_id, order_number: seen[0].order_number },
    };
  }

  const receivedAt = new Date();
  const { order, customer, lines } = await withTransaction(pool, async (client) => {
    const customer = await upsertCustomer(client, event.customer);
    const lines = await resolveLines(client, event.items);
    const order = await insertOrder(client, {
      paymentId,
      eventId,
      currency,
      amount: event.amount_cents,
      customer,
      lines,
      receivedAt,
    });
    return { order, customer, lines };
  });

  const key = invoiceKey(order);
  await storage.putJson(key, buildInvoice(order, customer, lines), {
    'order-number': order.order_number,
    'payment-id': paymentId,
  });

  log({
    event: 'webhook.payment',
    trace_id: traceId,
    message: `Bestellung ${order.order_number} angelegt`,
    attrs: { event_id: eventId, order_id: order.id, order_number: order.order_number, invoice_key: key, result: 'created' },
  });
  return {
    httpStatus: 201,
    body: { status: 'created', order_id: order.id, order_number: order.order_number, invoice_key: key },
  };
}
