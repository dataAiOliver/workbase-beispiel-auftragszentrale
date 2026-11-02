// Rechnungsdokumente (JSON) für das Archiv.
const VAT_RATE = 0.19;

export const SELLER = {
  name: 'Nordwerk Handel GmbH',
  street: 'Speicherstraße 7',
  postcode: '20457',
  city: 'Hamburg',
  vat_id: 'DE000000000',
};

export function orderNumberFor(id) {
  return `NW-${10000 + Number(id)}`;
}

export function invoiceKey(order) {
  const year = new Date(order.created_at).getUTCFullYear();
  return `invoices/${year}/${order.order_number}.json`;
}

export function buildInvoice(order, customer, items) {
  const total = items.reduce((sum, i) => sum + i.quantity * i.unit_price_cents, 0);
  const net = Math.round(total / (1 + VAT_RATE));
  const year = new Date(order.created_at).getUTCFullYear();
  return {
    invoice_number: `RE-${year}-${order.order_number.replace(/^NW-/, '')}`,
    order_number: order.order_number,
    order_id: order.id,
    payment_id: order.payment_id,
    issued_at: new Date(order.created_at).toISOString(),
    currency: order.currency,
    seller: SELLER,
    customer: {
      customer_number: customer.customer_number,
      name: customer.name,
      email: customer.email,
      street: customer.street,
      postcode: customer.postcode,
      city: customer.city,
      country: customer.country,
    },
    items: items.map((i) => ({
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unit_price_cents: i.unit_price_cents,
      total_cents: i.quantity * i.unit_price_cents,
    })),
    net_cents: net,
    vat_rate: VAT_RATE,
    vat_cents: total - net,
    total_cents: total,
  };
}
