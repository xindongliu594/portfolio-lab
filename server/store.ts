import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Operation, PlanSummary, Snapshot } from '../shared/types.js';

interface StoredPlan extends PlanSummary { snapshot: Snapshot; operations: Operation[] }
interface Row { id: string; name: string; created_at: string; snapshot: string; operations: string; snapshot_id: string }

export class PlanStore {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`PRAGMA busy_timeout = 3000;
      CREATE TABLE IF NOT EXISTS plans (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL,
        snapshot_id TEXT NOT NULL, snapshot TEXT NOT NULL, operations TEXT NOT NULL
      )`);
  }
  save(name: string, snapshot: Snapshot, operations: Operation[]): StoredPlan {
    const id = randomUUID();
    const createdAt = new Date().toISOString();
    // One INSERT atomically saves the original snapshot and ordered operations together.
    this.db.prepare('INSERT INTO plans VALUES (?, ?, ?, ?, ?, ?)').run(
      id, name, createdAt, snapshot.snapshot_id, JSON.stringify(snapshot), JSON.stringify(operations));
    return { id, name, createdAt, snapshotId: snapshot.snapshot_id, operationCount: operations.length, snapshot, operations };
  }
  list(): PlanSummary[] {
    const rows = this.db.prepare(`SELECT id, name, created_at AS createdAt, snapshot_id AS snapshotId,
      json_array_length(operations) AS operationCount FROM plans ORDER BY created_at DESC, rowid DESC`).all();
    return rows as unknown as PlanSummary[];
  }
  get(id: string): StoredPlan | undefined {
    const row = this.db.prepare('SELECT * FROM plans WHERE id = ?').get(id) as unknown as Row | undefined;
    if (!row) return undefined;
    const operations: Operation[] = JSON.parse(row.operations);
    return { id: row.id, name: row.name, createdAt: row.created_at, snapshotId: row.snapshot_id,
      operationCount: operations.length, snapshot: JSON.parse(row.snapshot), operations };
  }
  close() { this.db.close(); }
}
