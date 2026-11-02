import { api } from './api.js';
import { track } from './telemetry.js';
import { el, formatDate, formatDateTime, formatEuro, PAYMENT_STATUS, statusBadge, STATUS } from './format.js';
import { createSimulator } from './simulator.js';

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 25;
const state = { q: '', status: '', offset: 0, total: 0, seq: 0, openId: null };

// ---------- Kennzahlen ----------

async function loadStats() {
  try {
    const s = await api.stats();
    const set = (k, v) => (document.querySelector(`[data-kpi="${k}"]`).textContent = v);
    set('orders', s.orders.toLocaleString('de-DE'));
    set('revenue', formatEuro(s.revenue_cents));
    set('last7', s.last_7_days.toLocaleString('de-DE'));
    set('refunded', s.refunded.toLocaleString('de-DE'));
    set('dups', s.duplicate_payments.toLocaleString('de-DE'));
    $('kpi-dup').hidden = !(s.duplicate_payments > 0);
  } catch {
    // Kennzahlen sind optional – Liste zeigt eigene Fehler.
  }
}

// ---------- Auftragsliste ----------

function orderRow(o) {
  const dupWarning = o.payment_refs > 1;
  return el(
    'tr',
    { class: 'order-row', tabindex: '0', dataset: { id: o.id }, onclick: () => openOrder(o.id), onkeydown: (e) => e.key === 'Enter' && openOrder(o.id) },
    el('td', { 'data-label': 'Bestellung' },
      el('span', { class: 'order-no' }, o.order_number),
      o.channel === 'b2b' ? el('span', { class: 'chip' }, 'B2B') : null),
    el('td', { 'data-label': 'Datum' }, el('time', { datetime: o.created_at, title: formatDateTime(o.created_at) }, formatDate(o.created_at))),
    el('td', { 'data-label': 'Kunde' }, el('span', { class: 'cust' }, o.customer_name), el('span', { class: 'cust-city' }, o.customer_city ?? '')),
    el('td', { 'data-label': 'Artikel', class: 'num' }, String(o.item_count)),
    el('td', { 'data-label': 'Betrag', class: 'num amount' }, formatEuro(o.total_cents)),
    el('td', { 'data-label': 'Status' }, statusBadge(o.status)),
    el('td', { 'data-label': 'Zahlung' },
      el('code', { class: 'pid' }, o.payment_id ?? '–'),
      dupWarning ? el('span', { class: 'warn-dot', title: `Zahlung ist ${o.payment_refs} Bestellungen zugeordnet` }, `${o.payment_refs}×`) : null),
  );
}

async function loadOrders() {
  const seq = ++state.seq;
  const body = $('orders-body');
  body.setAttribute('aria-busy', 'true');
  $('orders-error').hidden = true;
  try {
    const params = { limit: PAGE_SIZE, offset: state.offset };
    if (state.q) params.q = state.q;
    if (state.status) params.status = state.status;
    const res = await api.orders(params);
    if (seq !== state.seq) return;
    state.total = res.total;
    body.replaceChildren(...res.orders.map(orderRow));
    const filtered = Boolean(state.q || state.status);
    $('orders-empty').hidden = res.orders.length > 0;
    $('orders-empty-hint').textContent = filtered
      ? 'Für diese Filter gibt es keine Treffer.'
      : 'Sobald Zahlungen eingehen, erscheinen die Bestellungen hier.';
    $('filters-reset').hidden = !filtered;
    $('orders-table').hidden = res.orders.length === 0;
    $('orders-count').textContent = `${res.total.toLocaleString('de-DE')} ${res.total === 1 ? 'Bestellung' : 'Bestellungen'}`;
    const pages = Math.ceil(res.total / PAGE_SIZE);
    $('pager').hidden = pages <= 1;
    $('page-info').textContent = `Seite ${Math.floor(state.offset / PAGE_SIZE) + 1} von ${pages}`;
    $('page-prev').disabled = state.offset === 0;
    $('page-next').disabled = state.offset + PAGE_SIZE >= res.total;
  } catch (err) {
    if (seq !== state.seq) return;
    body.replaceChildren();
    $('orders-error-text').textContent = `Bestellungen konnten nicht geladen werden: ${err.message}`;
    $('orders-error').hidden = false;
    track('orders.load_failed', { severity: 'error', outcome: 'error', message: err.message });
  } finally {
    if (seq === state.seq) body.removeAttribute('aria-busy');
  }
}

// ---------- Detailansicht ----------

function section(title, ...content) {
  return el('section', { class: 'd-section' }, el('h3', {}, title), ...content);
}

function invoicePreview(container, order) {
  container.replaceChildren(el('div', { class: 'invoice invoice--loading' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Rechnung wird aus dem Archiv geladen …'));
  api.invoice(order.order_number).then(
    ({ key, invoice }) => {
      container.replaceChildren(
        el('article', { class: 'invoice', 'aria-label': `Rechnung ${invoice.invoice_number}` },
          el('header', { class: 'invoice__head' },
            el('div', {}, el('strong', {}, invoice.seller.name), el('span', {}, `${invoice.seller.street} · ${invoice.seller.postcode} ${invoice.seller.city}`)),
            el('div', { class: 'invoice__no' }, el('span', {}, 'Rechnung'), el('strong', {}, invoice.invoice_number), el('span', {}, formatDate(invoice.issued_at)))),
          el('p', { class: 'invoice__to' }, invoice.customer.name, el('br'), invoice.customer.street ?? '', el('br'), `${invoice.customer.postcode ?? ''} ${invoice.customer.city ?? ''}`),
          el('table', { class: 'invoice__items' },
            el('tbody', {}, invoice.items.map((i) =>
              el('tr', {}, el('td', {}, `${i.quantity}×`), el('td', {}, i.name), el('td', { class: 'num' }, formatEuro(i.total_cents)))))),
          el('dl', { class: 'invoice__sum' },
            el('div', {}, el('dt', {}, 'Netto'), el('dd', {}, formatEuro(invoice.net_cents))),
            el('div', {}, el('dt', {}, `MwSt. ${Math.round(invoice.vat_rate * 100)} %`), el('dd', {}, formatEuro(invoice.vat_cents))),
            el('div', { class: 'total' }, el('dt', {}, 'Gesamt'), el('dd', {}, formatEuro(invoice.total_cents))))),
        el('p', { class: 'key' }, el('code', {}, key)),
      );
    },
    (err) => {
      const missing = err.status === 404;
      container.replaceChildren(
        el('div', { class: `callout ${missing ? 'callout--warn' : 'callout--error'}`, role: missing ? null : 'alert' },
          el('strong', {}, missing ? 'Keine Rechnung im Archiv' : 'Rechnung konnte nicht geladen werden'),
          el('span', {}, missing ? `Unter ${order.invoice_key} liegt kein Dokument.` : err.message)),
      );
    },
  );
}

function renderOrder(order) {
  $('drawer-eyebrow').replaceChildren('Bestellung · ', statusBadge(order.status));
  $('drawer-title').textContent = order.order_number;
  const c = order.customer;
  const invoiceBox = el('div', { class: 'invoice-box' });
  const sum = order.items.reduce((s, i) => s + i.quantity * i.unit_price_cents, 0);

  const parts = [
    order.same_payment_orders.length
      ? el('div', { class: 'callout callout--warn', role: 'note' },
          el('strong', {}, 'Zahlung mehrfach zugeordnet'),
          el('span', {}, `Die Zahlung ${order.payment_id} ist auch folgenden Bestellungen zugeordnet: `,
            order.same_payment_orders.map((o, i) => [i ? ', ' : '', el('button', { type: 'button', class: 'btn btn--link btn--inline', onclick: () => openOrder(o.id) }, o.order_number)])))
      : null,
    order.note ? el('p', { class: 'note' }, order.note) : null,
    el('dl', { class: 'facts' },
      el('div', {}, el('dt', {}, 'Angelegt'), el('dd', {}, formatDateTime(order.created_at))),
      el('div', {}, el('dt', {}, 'Kanal'), el('dd', {}, order.channel === 'b2b' ? 'B2B' : 'Webshop')),
      el('div', {}, el('dt', {}, 'Betrag'), el('dd', {}, formatEuro(order.total_cents)))),
    section('Kunde',
      el('div', { class: 'customer' },
        el('strong', {}, c.name), el('span', { class: 'muted' }, c.customer_number),
        el('span', {}, [c.street, `${c.postcode ?? ''} ${c.city ?? ''}`.trim()].filter(Boolean).join(', ')),
        el('span', {}, c.email), c.phone ? el('span', {}, c.phone) : null)),
    section(`Positionen (${order.items.length})`,
      el('table', { class: 'lines' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Menge'), el('th', {}, 'Artikel'), el('th', { class: 'num' }, 'Einzel'), el('th', { class: 'num' }, 'Summe'))),
        el('tbody', {}, order.items.map((i) => el('tr', {},
          el('td', {}, `${i.quantity}×`),
          el('td', {}, el('span', {}, i.name), el('code', { class: 'sku' }, i.sku)),
          el('td', { class: 'num' }, formatEuro(i.unit_price_cents)),
          el('td', { class: 'num' }, formatEuro(i.quantity * i.unit_price_cents))))),
        el('tfoot', {}, el('tr', {}, el('td', { colspan: '3' }, 'Gesamt'), el('td', { class: 'num' }, formatEuro(sum)))))),
    section('Zahlungen',
      el('ul', { class: 'payments' }, order.payments.map((p) => el('li', {},
        el('span', { class: `badge badge--${p.status === 'refunded' ? 'amber' : 'green'}` }, PAYMENT_STATUS[p.status] ?? p.status),
        el('div', {}, el('code', {}, p.payment_id), el('span', { class: 'muted' }, `Ereignis ${p.event_id ?? '–'} · ${formatDateTime(p.received_at)}`)),
        el('strong', { class: 'num' }, formatEuro(p.amount_cents)))))),
    section('Rechnung', invoiceBox),
  ];
  $('drawer-body').replaceChildren(...parts.filter(Boolean));
  invoicePreview(invoiceBox, order);
}

async function openOrder(id) {
  state.openId = id;
  const drawer = $('drawer');
  $('drawer-title').textContent = 'Bestellung';
  $('drawer-eyebrow').textContent = 'Bestellung';
  $('drawer-body').replaceChildren(el('p', { class: 'muted loading-line' }, el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Wird geladen …'));
  if (!drawer.open) drawer.showModal();
  requestAnimationFrame(() => drawer.classList.add('is-open'));
  try {
    const order = await api.order(id);
    if (state.openId !== id) return;
    renderOrder(order);
    track('orders.opened', { attrs: { order_id: id } });
  } catch (err) {
    $('drawer-body').replaceChildren(el('div', { class: 'callout callout--error', role: 'alert' }, el('strong', {}, 'Bestellung konnte nicht geladen werden'), el('span', {}, err.message)));
  }
}

function closeDrawer() {
  const drawer = $('drawer');
  drawer.classList.remove('is-open');
  drawer.close();
  state.openId = null;
}

// ---------- Start ----------

function renderMeta(meta) {
  const parts = [];
  if (meta.stage) parts.push(`Stage ${meta.stage}`);
  if (meta.dataset) parts.push(meta.dataset);
  if (meta.commit) parts.push(`Commit ${meta.commit.slice(0, 7)}`);
  $('meta').textContent = parts.join(' · ');
  if (meta.stage) {
    $('env-badge').textContent = meta.stage;
    $('env-badge').dataset.stage = meta.stage;
    $('env-badge').hidden = false;
  }
}

let searchTimer = null;
$('filter-q').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.q = e.target.value.trim();
    state.offset = 0;
    loadOrders();
  }, 250);
});
$('filters').addEventListener('submit', (e) => e.preventDefault());
$('filter-status').addEventListener('change', (e) => {
  state.status = e.target.value;
  state.offset = 0;
  loadOrders();
});
$('filters-reset').addEventListener('click', () => {
  state.q = '';
  state.status = '';
  state.offset = 0;
  $('filter-q').value = '';
  $('filter-status').value = '';
  loadOrders();
});
$('page-prev').addEventListener('click', () => { state.offset = Math.max(0, state.offset - PAGE_SIZE); loadOrders(); });
$('page-next').addEventListener('click', () => { state.offset += PAGE_SIZE; loadOrders(); });
$('orders-retry').addEventListener('click', loadOrders);
$('refresh').addEventListener('click', () => { loadStats(); loadOrders(); });
$('drawer-close').addEventListener('click', closeDrawer);
$('drawer').addEventListener('click', (e) => { if (e.target === $('drawer')) closeDrawer(); });
$('drawer').addEventListener('close', () => $('drawer').classList.remove('is-open'));

const simulator = createSimulator({
  onDelivered: async () => {
    await Promise.all([loadStats(), loadOrders()]);
  },
  onOpenOrder: openOrder,
});

(async function boot() {
  try {
    const meta = await api.meta();
    renderMeta(meta);
    await simulator.init(meta);
  } catch (err) {
    track('app.meta_failed', { severity: 'warn', outcome: 'error', message: err.message });
  }
  await Promise.all([loadStats(), loadOrders()]);
  document.body.classList.add('is-ready');
})();

export { STATUS };
