// PostgreSQL-Zugriff und Migrationen.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';
import { ROOT } from './runtime.mjs';

// bigint (int8) als Number liefern – IDs und Cent-Beträge bleiben weit unter 2^53.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10));

const MIGRATION_LOCK = 4_204_817;
const SEQUENCED_TABLES = ['customers', 'products', 'orders', 'order_items', 'payments'];

export function createPool(databaseUrl) {
  return new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 10_000 });
}

export async function withTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Basisschema + noch nicht angewendete Migrationen aus db/migrations.
 * Serialisiert über ein Advisory-Lock, damit parallele Starts sich nicht stören.
 * Danach werden die ID-Sequenzen hinter die höchste vorhandene ID gesetzt
 * (Stage-Daten werden mit expliziten IDs geladen).
 */
export async function migrate(pool) {
  const client = await pool.connect();
  const applied = [];
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(await readFile(path.join(ROOT, 'db', 'schema.sql'), 'utf8'));
    await client.query(
      'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
    );
    const dir = path.join(ROOT, 'db', 'migrations');
    const files = (await readdir(dir).catch(() => [])).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    const { rows } = await client.query('select name from schema_migrations');
    const done = new Set(rows.map((r) => r.name));
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      await client.query('begin');
      try {
        await client.query(sql);
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        applied.push(file);
      } catch (err) {
        await client.query('rollback');
        err.message = `Migration ${file} fehlgeschlagen: ${err.message}`;
        throw err;
      }
    }
    for (const table of SEQUENCED_TABLES) {
      await client.query(
        `select setval(pg_get_serial_sequence($1, 'id'), greatest((select coalesce(max(id), 0) from ${table}), 1),
                (select count(*) > 0 from ${table}))`,
        [table],
      );
    }
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
  return applied;
}
