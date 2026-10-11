import type { QueryResult, QueryResultRow } from 'pg';
import { query } from '../db/pool.ts';

/**
 * Audit logging for sensitive actions.
 *
 * Two records are written for moderation work:
 *   * `audit_logs` — who did what, from where, and whether it succeeded. Used
 *     for security review and for the administrator audit screen.
 *   * `moderation_actions` — the moderation-specific decision trail (from/to
 *     status, structured reason code) that also feeds moderation history.
 *
 * Neither table is ever deleted from: reports, disputes and moderation history
 * must remain inspectable, so closure is expressed through status columns.
 */
export interface AuditInput {
  actorId?: string | null;
  actorRole: 'anonymous' | 'user' | 'admin' | 'system';
  action: string;
  entityType: string;
  entityId?: string | null;
  outcome?: 'success' | 'failure' | 'denied';
  ipAddress?: string | null;
  userAgent?: string | null;
  requestId?: string | null;
  metadata?: Record<string, unknown>;
}

export type Executor = <T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params?: readonly unknown[],
) => Promise<QueryResult<T>>;

export async function recordAudit(input: AuditInput, executor: Executor = query): Promise<void> {
  await executor(
    `INSERT INTO audit_logs (actor_id, actor_role, action, entity_type, entity_id, outcome, ip_address, user_agent, request_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.actorId ?? null,
      input.actorRole,
      input.action,
      input.entityType,
      input.entityId ?? null,
      input.outcome ?? 'success',
      input.ipAddress ?? null,
      input.userAgent ?? null,
      input.requestId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

export interface ModerationActionInput {
  actorId: string | null;
  actorRole: 'admin' | 'system';
  action: string;
  entityType: string;
  entityId: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  reasonCode?: string | null;
  reasonNote?: string | null;
  metadata?: Record<string, unknown>;
}

export async function recordModerationAction(input: ModerationActionInput, executor: Executor = query): Promise<void> {
  await executor(
    `INSERT INTO moderation_actions (actor_id, actor_role, action, entity_type, entity_id, from_status, to_status, reason_code, reason_note, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.actorId,
      input.actorRole,
      input.action,
      input.entityType,
      input.entityId,
      input.fromStatus ?? null,
      input.toStatus ?? null,
      input.reasonCode ?? null,
      input.reasonNote ?? null,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
}

/** Convenience wrapper so services can pass their transaction context. */
export function executorFromTx(tx: {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<QueryResult<T>>;
}): Executor {
  return (sql, params) => tx.query(sql, params);
}
