// Strukturierte Logs: eine JSON-Zeile pro Ereignis auf stdout.
import { randomBytes } from 'node:crypto';

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-[0-9a-f]{2}$/;

export function newTraceId() {
  return randomBytes(16).toString('hex');
}

export function newSpanId() {
  return randomBytes(8).toString('hex');
}

/** Trace-ID aus eingehendem `traceparent` übernehmen, sonst neu erzeugen. */
export function traceFromHeaders(headers) {
  const match = TRACEPARENT.exec(String(headers?.traceparent ?? '').trim().toLowerCase());
  if (match && !/^0+$/.test(match[1])) return match[1];
  return newTraceId();
}

export function traceparent(traceId) {
  return `00-${traceId}-${newSpanId()}-01`;
}

function serializeError(err) {
  if (!err) return null;
  return {
    type: err.name ?? 'Error',
    message: String(err.message ?? err),
    code: err.code ?? null,
    stack: err.stack ? String(err.stack).split('\n').slice(0, 6).join('\n') : null,
  };
}

export function log({
  severity = 'info',
  event,
  outcome = 'ok',
  duration_ms = null,
  trace_id = null,
  message = '',
  error = null,
  attrs = {},
}) {
  const line = {
    ts: new Date().toISOString(),
    severity,
    event,
    outcome,
    duration_ms,
    trace_id,
    message,
    error: serializeError(error),
    model: null,
    attrs,
  };
  process.stdout.write(`${JSON.stringify(line)}\n`);
}
