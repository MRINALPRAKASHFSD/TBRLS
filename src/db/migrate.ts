import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations(customDatabaseUrl?: string): Promise<string[]> {
  const dbUrl = customDatabaseUrl || config.databaseUrl;
  const client = new pg.Client({ connectionString: dbUrl });

  await client.connect();
  const appliedMigrations: string[] = [];

  try {
    // Ensure migrations tracking table exists
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id SERIAL PRIMARY KEY,
        migration_name VARCHAR(255) UNIQUE NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Fetch already applied migrations
    const res = await client.query('SELECT migration_name FROM schema_migrations ORDER BY id ASC;');
    const appliedSet = new Set(res.rows.map((r) => r.migration_name));

    // Discover migration files
    const migrationsDir = path.resolve(__dirname, 'migrations');
    const files = (await fs.readdir(migrationsDir))
      .filter((file) => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (!appliedSet.has(file)) {
        console.log(`[MIGRATION] Applying: ${file}...`);
        const sqlPath = path.join(migrationsDir, file);
        const sqlContent = await fs.readFile(sqlPath, 'utf8');

        await client.query('BEGIN;');
        try {
          await client.query(sqlContent);
          await client.query(
            'INSERT INTO schema_migrations (migration_name) VALUES ($1);',
            [file]
          );
          await client.query('COMMIT;');
          appliedMigrations.push(file);
          console.log(`[MIGRATION] Successfully applied: ${file}`);
        } catch (err) {
          await client.query('ROLLBACK;');
          console.error(`[MIGRATION ERROR] Failed on ${file}:`, err);
          throw err;
        }
      }
    }
  } finally {
    await client.end();
  }

  return appliedMigrations;
}

// When executed directly via `npm run migrate`
if (process.argv[1] && process.argv[1].endsWith('migrate.ts')) {
  runMigrations()
    .then((applied) => {
      console.log(`[MIGRATION] Complete. Applied ${applied.length} new migrations.`);
      process.exit(0);
    })
    .catch((err) => {
      console.error('[MIGRATION] Fatal migration failure:', err);
      process.exit(1);
    });
}
