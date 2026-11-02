// Panel „Zahlungseingang simulieren“: baut PayNord-Ereignisse und stellt sie zu.
import { api } from './api.js';
import { el, formatEuro, formatTime } from './format.js';
import { track } from './telemetry.js';

const $ = (id) => document.getElementById(id);

const CUSTOMERS = [
  { name: 'Frieda Brünning', email: 'frieda.bruenning@example.invalid', phone: '+49 40 555 0161', street: 'Am Wall 112', postcode: '28195', city: 'Bremen', country: 'DE' },
  { name: 'Hauke Jürgensen', email: 'hauke.juergensen@example.invalid', phone: '+49 40 555 0162', street: 'Großstraße 9', postcode: '25813', city: 'Husum', country: 'DE' },
  { name: 'Ilka Thomßen', email: 'ilka.thomssen@example.invalid', phone: '+49 40 555 0163', street: 'Holstenstraße 41', postcode: '24103', city: 'Kiel', country: 'DE' },
  { name: 'Gärtnerei Lührs GbR', email: 'einkauf.luehrs@example.invalid', phone: '+49 40 555 0164', street: 'Achternstraße 3', postcode: '26122', city: 'Oldenburg', country: 'DE' },
];

function randomToken(len) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => (b % 36).toString(36)).join('');
}

const nr = (n) => el('span', { class: 'nowrap' }, n ?? '–');

export const RESULT_TEXT = {
  created: (b) => ['Bestellung ', nr(b.order_number), ' angelegt'],
  already_processed: (b) => ['Bereits verbucht – ', nr(b.order_number)],
  duplicate: (b) => ['Bereits verbucht – ', nr(b.order_number)],
  ignored: (b) => [b.message],
  error: (b) => [b.message ?? 'Fehler'],
};

export function createSimulator({ onDelivered, onOpenOrder }) {
  let products = [];
  let event = null;
  let sentOnce = false;

  function buildBasket() {
    if (!products.length) return [];
    const count = 1 + Math.floor(Math.random() * 3);
    const chosen = new Map();
    while (chosen.size < Math.min(count, products.length)) {
      const p = products[Math.floor(Math.random() * products.length)];
      chosen.set(p.sku, { sku: p.sku, name: p.name, quantity: Math.random() < 0.7 ? 1 : 2, unit_price_cents: p.price_cents });
    }
    return [...chosen.values()];
  }

  function newEvent() {
    const items = buildBasket();
    event = {
      event_id: `evt_sim_${randomToken(16)}`,
      type: 'payment.succeeded',
      payment_id: `pn_sim_${randomToken(12)}`,
      amount_cents: items.reduce((s, i) => s + i.quantity * i.unit_price_cents, 0),
      currency: 'EUR',
      customer: CUSTOMERS[Number($('sim-customer').value) || 0],
      items,
    };
    sentOnce = false;
    render();
  }

  function render() {
    $('sim-event-id').textContent = event?.event_id ?? '–';
    $('sim-payment-id').textContent = event?.payment_id ?? '–';
    $('sim-items').replaceChildren(
      ...(event?.items.length
        ? event.items.map((i) =>
            el('li', {}, el('span', { class: 'qty' }, `${i.quantity}×`), el('span', { class: 'name' }, i.name), el('span', { class: 'price' }, formatEuro(i.quantity * i.unit_price_cents))),
          )
        : [el('li', { class: 'muted' }, 'Keine Artikel verfügbar.')]),
    );
    $('sim-amount').textContent = event ? formatEuro(event.amount_cents) : '–';
    $('sim-resend').disabled = !sentOnce;
    $('sim-send').disabled = !event?.items.length || sentOnce;
    $('sim-double').disabled = !event?.items.length;
  }

  function logEntry(mode, res, ms) {
    const list = $('sim-log');
    list.querySelector('.sim-log__empty')?.remove();
    const body = res.data ?? {};
    const status = body.status ?? 'error';
    const text = (RESULT_TEXT[status] ?? RESULT_TEXT.error)(body);
    const ok = res.status >= 200 && res.status < 300;
    const item = el(
      'li',
      { class: `sim-log__item sim-log__item--${status}`, dataset: { status } },
      el('span', { class: `http http--${ok ? 'ok' : 'err'}` }, String(res.status || '—')),
      el(
        'div',
        { class: 'sim-log__main' },
        el('span', { class: 'sim-log__text' }, text),
        el('span', { class: 'sim-log__meta' }, `${formatTime(new Date())} · ${mode} · ${event.event_id.slice(0, 18)}… · ${ms} ms`),
      ),
      body.order_id
        ? el('button', { type: 'button', class: 'btn btn--link btn--small', onclick: () => onOpenOrder(body.order_id) }, 'Öffnen')
        : null,
    );
    list.prepend(item);
    while (list.children.length > 12) list.lastElementChild.remove();
  }

  async function deliver(mode, times) {
    const buttons = ['sim-send', 'sim-resend', 'sim-double'].map($);
    buttons.forEach((b) => (b.disabled = true));
    const started = performance.now();
    const results = await Promise.all(Array.from({ length: times }, () => api.deliverWebhook(event)));
    const ms = Math.round(performance.now() - started);
    for (const res of results) logEntry(mode, res, ms);
    sentOnce = true;
    track('simulator.webhook_delivered', { attrs: { mode, times, statuses: results.map((r) => r.data?.status) } });
    render();
    await onDelivered(results);
  }

  $('sim-customer').replaceChildren(...CUSTOMERS.map((c, i) => el('option', { value: i }, `${c.name} · ${c.city}`)));
  $('sim-customer').addEventListener('change', () => {
    if (event) {
      event.customer = CUSTOMERS[Number($('sim-customer').value)];
      if (sentOnce) newEvent();
    }
  });
  $('sim-reroll').addEventListener('click', newEvent);
  $('sim-new').addEventListener('click', newEvent);
  $('sim-send').addEventListener('click', () => deliver('einmal', 1));
  $('sim-resend').addEventListener('click', () => deliver('erneut', 1));
  $('sim-double').addEventListener('click', () => deliver('gleichzeitig', 2));

  return {
    async init(meta) {
      $('cfg-provider').textContent = meta.paymentProviderUrl;
      $('cfg-bucket').textContent = `s3://${meta.invoiceBucket}/invoices/`;
      try {
        products = (await api.products()).products;
      } catch {
        products = [];
      }
      newEvent();
    },
  };
}
