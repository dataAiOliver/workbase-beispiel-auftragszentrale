// Build: Syntaxprüfung aller .mjs/.js-Module und Kopie von public/ nach dist/
// mit Content-Hash im Dateinamen der JS/CSS-Dateien.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
const DIST = path.join(ROOT, 'dist');
const SKIP = new Set(['node_modules', 'dist', '.git', '.workbase', 'test-results', 'playwright-report']);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

const started = performance.now();
const files = await walk(ROOT);
const modules = files.filter((f) => f.endsWith('.mjs') || (f.startsWith(PUBLIC) && f.endsWith('.js')));
let failed = 0;
for (const file of modules) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: ['ignore', 'ignore', 'pipe'] });
  } catch (err) {
    failed += 1;
    process.stderr.write(`Syntaxfehler in ${path.relative(ROOT, file)}:\n${err.stderr}\n`);
  }
}
for (const file of files.filter((f) => f.endsWith('.json') && !f.endsWith('package-lock.json'))) {
  try {
    JSON.parse(await readFile(file, 'utf8'));
  } catch (err) {
    failed += 1;
    process.stderr.write(`Ungültiges JSON in ${path.relative(ROOT, file)}: ${err.message}\n`);
  }
}
if (failed) {
  process.stderr.write(`Build fehlgeschlagen: ${failed} Datei(en) fehlerhaft.\n`);
  process.exit(1);
}

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST, { recursive: true });
await cp(PUBLIC, path.join(DIST, 'public'), { recursive: true });

const assets = (await walk(path.join(DIST, 'public'))).filter((f) => /\.(js|css)$/.test(f));
const manifest = {};
for (const file of assets) {
  const hash = createHash('sha256').update(await readFile(file)).digest('hex').slice(0, 10);
  const ext = path.extname(file);
  const hashedName = `${path.basename(file, ext)}.${hash}${ext}`;
  manifest[path.basename(file)] = hashedName;
}
const textFiles = (await walk(path.join(DIST, 'public'))).filter((f) => /\.(js|css|html)$/.test(f));
for (const file of textFiles) {
  let text = await readFile(file, 'utf8');
  for (const [name, hashed] of Object.entries(manifest)) {
    text = text.replaceAll(`./${name}'`, `./${hashed}'`).replaceAll(`./${name}"`, `./${hashed}"`);
  }
  const ext = path.extname(file);
  const target = manifest[path.basename(file)] ? path.join(path.dirname(file), manifest[path.basename(file)]) : file;
  await writeFile(target, text);
  if (target !== file) await rm(file);
}
await writeFile(path.join(DIST, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

console.log(
  `Build ok: ${modules.length} Module geprüft, ${Object.keys(manifest).length} Assets gehasht ` +
    `in ${Math.round(performance.now() - started)} ms → dist/`,
);
