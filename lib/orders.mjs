// Lesende Abfragen für Bestellübersicht und Detailansicht.
import { invoiceKey } from './invoice.mjs';

const STATUSES = new Set(['bezahlt', 'versandt', 'erstattet', 'storniert']);

export async function listOrders(pool, { status, q, limit = 50, offset = 0 } = {}) {
  const where = [];
  const params = [];
  if (status && STATUSES.has(status)) {
    params.push(status);
    where.push(`o.status = $${params.length}`);
  }
  if (q && q.trim()) {
    params.push(`%${q.trim().toLowerCase()}%`);
    const p = `$${params.length}`;
    where.push(`(lower(o.order_number) like ${p} or lower(c.name) like ${p} or lower(coalesce(o.payment_id, '')) like ${p})`);
  }
  const clause = where.length ? `where ${where.join(' and ')}` : '';
  const lim = Math.min(Math.max(Number.parseInt(limit, 10) || 50, 1), 200);
  const off = Math.max(Number.parseInt(offset, 10) || 0, 0);

  const { rows } = await pool.query(
    `select o.id, o.order_number, o.status, o.channel, o.payment_id, o.total_cents, o.currency, o.created_at,
            c.id as customer_id, c.name as customer_name, c.city as customer_city,
            (select coalesce(sum(i.quantity), 0)::int from order_items i where i.order_id = o.id) as item_count,
            (select count(*)::int from orders o2 where o2.payment_id = o.payment_id) as payment_refs
       from orders o
       join customers c on c.id = o.customer_id
       ${clause}
      order by o.created_at desc, o.id desc
      limit ${lim} offset ${off}`,
    params,
  );
  const { rows: [{ total }] } = await pool.query(
    `select count(*)::int as total from orders o join customers c on c.id = o.customer_id ${clause}`,
    params,
  );
  return { orders: rows, total, limit: lim, offset: off };
}

export async function orderStats(pool) {
  const { rows: [s] } = await pool.query(
    `select count(*)::int as orders,
            coalesce(sum(total_cents) filter (where status <> 'erstattet' and status <> 'storniert'), 0)::bigint as revenue_cents,
            count(*) filter (where status = 'erstattet')::int as refunded,
            count(*) filter (where created_at >= now() - interval '7 days')::int as last_7_days,
            (select count(*)::int from (
               select payment_id from orders where payment_id is not null group by payment_id having count(*) > 1
             ) d) as duplicate_payments
       from orders`,
  );
  return s;
}

export async function getOrder(pool, id) {
  const { rows: [order] } = await pool.query(
    `select o.*, row_to_json(c.*) as customer
       from orders o join customers c on c.id = o.customer_id
      where o.id = $1`,
    [id],
  );
  if (!order) return null;
  const [{ rows: items }, { rows: payments }, { rows: siblings }] = await Promise.all([
    pool.query('select * from order_items where order_id = $1 order by id', [id]),
    pool.query('select * from payments where order_id = $1 order by received_at, id', [id]),
    order.payment_id
      ? pool.query('select id, order_number from orders where payment_id = $1 and id <> $2 order by id', [order.payment_id, id])
      : { rows: [] },
  ]);
  return { ...order, items, payments, same_payment_orders: siblings, invoice_key: invoiceKey(order) };
}

export async function findOrderByNumber(pool, orderNumber) {
  const { rows: [order] } = await pool.query(
    'select id, order_number, created_at from orders where order_number = $1 order by id limit 1',
    [orderNumber],
  );
  return order ?? null;
}

export async function listProducts(pool) {
  const { rows } = await pool.query('select id, sku, name, category, price_cents from products order by id');
  return rows;
}
