// Laufzeitkontext: Projekt, Stage, Datenstand und ausgelieferter Commit.
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function detectCommit() {
  try {
    const out = execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 3000,
    }).trim();
    if (/^[0-9a-f]{40}$/.test(out)) return out;
  } catch {
    // kein Git-Checkout – Fallback unten
  }
  const fromEnv = (process.env.WORKBASE_COMMIT ?? '').trim();
  return fromEnv || null;
}

export const runtime = Object.freeze({
  project: process.env.WORKBASE_PROJECT || 'nordwerk-orders',
  stage: process.env.WORKBASE_STAGE || null,
  dataset: process.env.WORKBASE_DATASET_LABEL || null,
  commit: detectCommit(),
});
