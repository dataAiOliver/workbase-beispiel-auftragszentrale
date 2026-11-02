const euro = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const dateTime = new Intl.DateTimeFormat('de-DE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Europe/Berlin' });
const date = new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' });
const time = new Intl.DateTimeFormat('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Berlin' });

export const formatEuro = (cents) => euro.format((cents ?? 0) / 100);
export const formatDateTime = (iso) => dateTime.format(new Date(iso));
export const formatDate = (iso) => date.format(new Date(iso));
export const formatTime = (d) => time.format(d);

export const STATUS = {
  bezahlt: { label: 'Bezahlt', tone: 'indigo' },
  versandt: { label: 'Versandt', tone: 'green' },
  erstattet: { label: 'Erstattet', tone: 'amber' },
  storniert: { label: 'Storniert', tone: 'gray' },
};

export const PAYMENT_STATUS = { succeeded: 'Eingegangen', refunded: 'Erstattet' };

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

export function statusBadge(status) {
  const s = STATUS[status] ?? { label: status, tone: 'gray' };
  return el('span', { class: `badge badge--${s.tone}` }, s.label);
}
