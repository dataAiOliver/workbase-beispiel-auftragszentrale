// Browser-Ereignisse an den Workbase-Collector (Fehler beim Senden werden ignoriert).
const pageTrace = randomHex(32);

function randomHex(len) {
  const bytes = new Uint8Array(len / 2);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export function traceHeaders() {
  return { traceparent: `00-${pageTrace}-${randomHex(16)}-01` };
}

export function track(event, { severity = 'info', outcome = 'ok', duration_ms = null, message = '', attrs = {} } = {}) {
  try {
    const body = JSON.stringify({ event, severity, outcome, duration_ms, trace_id: pageTrace, message, attrs });
    navigator.sendBeacon?.('/__workbase/telemetry', new Blob([body], { type: 'application/json' }));
  } catch {
    // Telemetrie darf die Kasse nie stören.
  }
}

window.addEventListener('error', (e) => {
  track('browser.error', { severity: 'error', outcome: 'error', message: String(e.message ?? 'Fehler'), attrs: { source: e.filename ?? null, line: e.lineno ?? null } });
});
window.addEventListener('unhandledrejection', (e) => {
  track('browser.unhandled_rejection', { severity: 'error', outcome: 'error', message: String(e.reason?.message ?? e.reason ?? 'Unbekannt') });
});
