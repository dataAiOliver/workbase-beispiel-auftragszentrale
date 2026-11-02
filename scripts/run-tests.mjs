// Führt alle node:test-Dateien aus und schreibt den Workbase-Testbericht.
import { run } from 'node:test';
import { readdir, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reportPath = path.resolve(ROOT, process.env.WORKBASE_TEST_REPORT || '.workbase/test-report.json');
const files = (await readdir(path.join(ROOT, 'tests')))
  .filter((f) => f.endsWith('.test.mjs'))
  .sort()
  .map((f) => path.join(ROOT, 'tests', f));

function shorten(err) {
  if (!err) return null;
  const cause = err.cause ?? err;
  const text = String(cause?.message ?? cause).trim();
  return text.length > 600 ? `${text.slice(0, 600)} …` : text;
}

const started = performance.now();
const tests = [];
const pending = new Map(); // file → Tests, die noch auf ihre Suite warten

const stream = run({ files, concurrency: 1, timeout: 60_000 });

function record(data, status) {
  const file = data.file ?? '';
  const rel = path.relative(ROOT, file) || file;
  if (data.details?.type === 'suite') {
    const waiting = pending.get(file) ?? [];
    const mine = waiting.filter((t) => t.nesting === data.nesting + 1 && !t.suite);
    for (const t of mine) t.suite = data.name;
    return;
  }
  if (data.nesting === 0 && data.name === rel) return; // Datei-Ebene
  const entry = {
    suite: null,
    name: data.name,
    file: rel,
    status: data.skip || data.todo ? 'skipped' : status,
    duration_ms: Math.round(data.details?.duration_ms ?? 0),
    error: status === 'failed' ? shorten(data.details?.error) : null,
    nesting: data.nesting,
  };
  tests.push(entry);
  if (!pending.has(file)) pending.set(file, []);
  pending.get(file).push(entry);
}

stream.on('test:pass', (data) => record(data, 'passed'));
stream.on('test:fail', (data) => {
  // Fehler in Hooks/Suiten (z. B. before) zählen als fehlgeschlagener Test der Suite.
  if (data.details?.type === 'suite') {
    const err = data.details?.error;
    if (err && err.failureType !== 'subtestsFailed') {
      tests.push({
        suite: data.name,
        name: `${data.name} (Vorbereitung)`,
        file: path.relative(ROOT, data.file ?? ''),
        status: 'failed',
        duration_ms: Math.round(data.details?.duration_ms ?? 0),
        error: shorten(err),
        nesting: data.nesting,
      });
    }
  }
  record(data, 'failed');
});
stream.on('test:diagnostic', () => {});
stream.on('test:stdout', () => {});
stream.on('test:stderr', (data) => process.stderr.write(data.message));

for await (const event of stream) {
  if (event.type === 'test:pass' || event.type === 'test:fail') {
    const d = event.data;
    if (d.details?.type === 'suite' || (d.nesting === 0 && d.name.endsWith('.mjs'))) continue;
    const mark = event.type === 'test:pass' ? '✓' : d.skip || d.todo ? '-' : '✘';
    console.log(`  ${mark} ${d.name} (${Math.round(d.details?.duration_ms ?? 0)} ms)`);
    if (event.type === 'test:fail') console.log(`      ${shorten(d.details?.error)?.split('\n').join('\n      ')}`);
  }
}

const out = tests.map(({ nesting, ...t }) => t);
const report = {
  tool: 'node:test',
  passed: out.filter((t) => t.status === 'passed').length,
  failed: out.filter((t) => t.status === 'failed').length,
  skipped: out.filter((t) => t.status === 'skipped').length,
  duration_ms: Math.round(performance.now() - started),
  tests: out,
};
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(`\nTestbericht: ${report.passed} bestanden, ${report.failed} fehlgeschlagen, ${report.skipped} übersprungen → ${path.relative(ROOT, reportPath) || reportPath}`);
process.exit(report.failed > 0 ? 1 : 0);
