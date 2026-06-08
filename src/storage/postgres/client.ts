import pg from 'pg'
import {
  PALMOS_POSTGRES_MIGRATION_VERSION,
  PALMOS_POSTGRES_SCHEMA_SQL,
} from './schema.js'

const { Pool } = pg

export type PostgresPool = pg.Pool

export type PalmosStorageDriver = 'file' | 'postgres'

export function readPalmosStorageDriver(
  env: Record<string, string | undefined> = process.env,
): PalmosStorageDriver {
  const value = env.PALMOS_STORAGE_DRIVER?.trim().toLowerCase()
  if (!value || value === 'file') {
    return 'file'
  }
  if (value === 'postgres') {
    return 'postgres'
  }
  throw new Error('PALMOS_STORAGE_DRIVER must be set to file or postgres.')
}

export function createPostgresPool(input: {
  databaseUrl?: string
  env?: Record<string, string | undefined>
} = {}): PostgresPool {
  const databaseUrl =
    input.databaseUrl ?? input.env?.PALMOS_DATABASE_URL ?? process.env.PALMOS_DATABASE_URL
  if (!databaseUrl) {
    throw new Error('PALMOS_DATABASE_URL is required when using Postgres storage.')
  }

  return new Pool({
    connectionString: databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })
}

export async function verifyPostgresConnection(pool: PostgresPool): Promise<void> {
  await pool.query('select 1')
}

export async function runPalmosPostgresMigrations(
  pool: PostgresPool,
): Promise<{ version: string }> {
  await pool.query(PALMOS_POSTGRES_SCHEMA_SQL)
  return { version: PALMOS_POSTGRES_MIGRATION_VERSION }
}

export async function listPalmosPostgresMigrations(
  pool: PostgresPool,
): Promise<Array<{ version: string; appliedAt: string; description: string }>> {
  const result = await pool.query<{
    version: string
    applied_at: Date | string
    description: string
  }>(
    'select version, applied_at, description from palmos_schema_migrations order by applied_at asc',
  )
  return result.rows.map((row) => ({
    version: row.version,
    appliedAt:
      row.applied_at instanceof Date
        ? row.applied_at.toISOString()
        : new Date(row.applied_at).toISOString(),
    description: row.description,
  }))
}

export function readJsonRecord<T>(value: unknown): T {
  return typeof value === 'string' ? (JSON.parse(value) as T) : (value as T)
}
