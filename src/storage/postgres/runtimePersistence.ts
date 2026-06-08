import { createHash, randomUUID } from 'crypto'
import type {
  ArtifactRef,
  ExecutionLedger,
  LedgerEvent,
} from '../../../runtime/contracts/ledger.js'
import type { TranscriptEntry } from '../../../runtime/contracts/runtime.js'
import type {
  ArtifactStore,
  KernelPersistence,
  TranscriptStore,
} from '../../../runtime/runtime/kernelPersistence.js'
import { readJsonRecord, type PostgresPool } from './client.js'

function toJson(value: unknown): string {
  return JSON.stringify(value)
}

function createContentHash(value: unknown): string | undefined {
  if (value == null) {
    return undefined
  }
  const serialized = typeof value === 'string' ? value : JSON.stringify(value)
  return createHash('sha256').update(serialized).digest('hex')
}

export class PostgresTranscriptStore implements TranscriptStore {
  constructor(private readonly pool: PostgresPool) {}

  async append(entry: TranscriptEntry): Promise<void> {
    await this.pool.query(
      `insert into runtime_transcript_entries (
        entry_id, session_id, run_id, at, record
      ) values ($1, $2, $3, $4, $5::jsonb)
      on conflict (entry_id) do update set
        session_id = excluded.session_id,
        run_id = excluded.run_id,
        at = excluded.at,
        record = excluded.record`,
      [
        entry.entryId,
        entry.sessionId,
        entry.runId ?? null,
        entry.at,
        toJson(entry),
      ],
    )
  }

  async list(sessionId: string): Promise<TranscriptEntry[]> {
    const result = await this.pool.query<{ record: unknown }>(
      'select record from runtime_transcript_entries where session_id = $1 order by at asc',
      [sessionId],
    )
    return result.rows.map((row) => readJsonRecord<TranscriptEntry>(row.record))
  }
}

export class PostgresExecutionLedger implements ExecutionLedger {
  constructor(private readonly pool: PostgresPool) {}

  async append(event: LedgerEvent): Promise<void> {
    await this.pool.query(
      `insert into runtime_ledger_events (event_id, run_id, at, record)
      values ($1, $2, $3, $4::jsonb)
      on conflict (event_id) do update set
        run_id = excluded.run_id,
        at = excluded.at,
        record = excluded.record`,
      [event.eventId, event.runId, event.at, toJson(event)],
    )
  }

  async listForRun(runId: string): Promise<LedgerEvent[]> {
    const result = await this.pool.query<{ record: unknown }>(
      'select record from runtime_ledger_events where run_id = $1 order by at asc',
      [runId],
    )
    return result.rows.map((row) => readJsonRecord<LedgerEvent>(row.record))
  }
}

export class PostgresArtifactStore implements ArtifactStore {
  constructor(private readonly pool: PostgresPool) {}

  async write(
    artifact: Omit<ArtifactRef, 'artifactId'> & { artifactId?: string },
    data?: unknown,
  ): Promise<ArtifactRef> {
    const artifactId = artifact.artifactId ?? `artifact_${randomUUID()}`
    const ref: ArtifactRef = {
      artifactId,
      artifactType: artifact.artifactType,
      path: artifact.path,
      hash: artifact.hash ?? createContentHash(data),
    }

    await this.pool.query(
      `insert into runtime_artifacts (
        artifact_id, artifact_type, path, hash, data, record
      ) values ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
      on conflict (artifact_id) do update set
        artifact_type = excluded.artifact_type,
        path = excluded.path,
        hash = excluded.hash,
        data = excluded.data,
        record = excluded.record`,
      [
        ref.artifactId,
        ref.artifactType,
        ref.path,
        ref.hash ?? null,
        data === undefined ? null : toJson(data),
        toJson(ref),
      ],
    )

    return ref
  }
}

export class PostgresKernelPersistence implements KernelPersistence {
  readonly transcript: TranscriptStore
  readonly ledger: ExecutionLedger
  readonly artifacts: ArtifactStore

  constructor(pool: PostgresPool) {
    this.transcript = new PostgresTranscriptStore(pool)
    this.ledger = new PostgresExecutionLedger(pool)
    this.artifacts = new PostgresArtifactStore(pool)
  }

  async flushCritical(_sessionId: string, _runId?: string): Promise<void> {
    return
  }

  async closeSession(_sessionId: string): Promise<void> {
    return
  }
}
