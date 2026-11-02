import { traceHeaders } from './telemetry.js';

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function request(path, { method = 'GET', body } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...traceHeaders() },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError('Keine Verbindung zum Server.', 0, null);
  }
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(data?.message ?? `Fehler ${res.status}`, res.status, data);
  return { status: res.status, data };
}

export const api = {
  meta: async () => (await request('/api/meta')).data,
  stats: async () => (await request('/api/stats')).data,
  products: async () => (await request('/api/products')).data,
  orders: async (params) => (await request(`/api/orders?${new URLSearchParams(params)}`)).data,
  order: async (id) => (await request(`/api/orders/${id}`)).data,
  invoice: async (orderNumber) => (await request(`/api/invoices/${encodeURIComponent(orderNumber)}`)).data,
  /** Liefert Status und Antwort auch bei Fehlerstatus – für das Zustellprotokoll. */
  async deliverWebhook(event) {
    try {
      return await request('/api/webhooks/payment', { method: 'POST', body: event });
    } catch (err) {
      return { status: err.status, data: err.body ?? { status: 'error', message: err.message } };
    }
  },
};
