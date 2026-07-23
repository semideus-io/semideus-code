import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { ModelMessage } from "ai";
import type { DecisionEvent, UsageTotals } from "./contracts/events";
import type { Concept } from "./contracts/learning";

export interface SessionMeta {
  id: string;
  createdAt: number;
  updatedAt: number;
  cwd: string;
  title: string;
  model: string;
  mode: string;
}

export interface SessionData extends SessionMeta {
  messages: ModelMessage[];
  usage: UsageTotals;
}

export interface SnapshotRow {
  id: number;
  step: number;
  path: string;
  existed: boolean;
  content: string | null;
}

export function defaultDataDir(): string {
  const base = process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share");
  return join(base, "demi");
}

const EMPTY_USAGE: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
};

/**
 * Everything demi remembers lives here: sessions (messages as one JSON blob —
 * pragmatic v1), the decision log (rows: the learning layer queries them),
 * pre-mutation file snapshots (backs /undo), and the concept ledger.
 */
export class SessionStore {
  readonly path: string;
  private readonly db: Database;

  constructor(path?: string) {
    this.path = path ?? join(defaultDataDir(), "demi.sqlite");
    if (this.path !== ":memory:") mkdirSync(dirname(this.path), { recursive: true });
    this.db = new Database(this.path);
    this.db.exec("pragma journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.db.exec(`
      create table if not exists sessions (
        id text primary key,
        created_at integer not null,
        updated_at integer not null,
        cwd text not null,
        title text not null,
        model text not null,
        mode text not null default 'default',
        messages_json text not null default '[]',
        usage_json text not null default '{}'
      );
      create table if not exists decisions (
        id integer primary key autoincrement,
        session_id text not null,
        step integer not null,
        ts integer not null,
        kind text not null,
        summary text not null,
        rationale text not null,
        alternatives_json text,
        refs_json text not null default '[]',
        artifact_json text
      );
      create index if not exists decisions_session on decisions(session_id, step);
      create table if not exists snapshots (
        id integer primary key autoincrement,
        session_id text not null,
        step integer not null,
        ts integer not null,
        path text not null,
        existed integer not null,
        content text
      );
      create index if not exists snapshots_session on snapshots(session_id, step);
      create table if not exists concepts (
        slug text primary key,
        name text not null,
        kind text not null,
        example text not null,
        first_seen integer not null,
        occurrences integer not null default 1
      );
    `);
    // `create table if not exists` never widens an existing table, so columns
    // added after a release need this. Sessions predating the column read back
    // with artifact undefined — /why degrades to refs, it doesn't break.
    this.addColumn("decisions", "artifact_json", "text");
  }

  private addColumn(table: string, column: string, decl: string): void {
    const cols = this.db.query<{ name: string }, []>(`pragma table_info(${table})`).all();
    if (cols.some((col) => col.name === column)) return;
    this.db.exec(`alter table ${table} add column ${column} ${decl}`);
  }

  upsertSession(data: SessionData): void {
    this.db
      .query(
        `insert into sessions (id, created_at, updated_at, cwd, title, model, mode, messages_json, usage_json)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)
         on conflict(id) do update set
           updated_at = excluded.updated_at,
           title = excluded.title,
           model = excluded.model,
           mode = excluded.mode,
           messages_json = excluded.messages_json,
           usage_json = excluded.usage_json`,
      )
      .run(
        data.id,
        data.createdAt,
        data.updatedAt,
        data.cwd,
        data.title,
        data.model,
        data.mode,
        JSON.stringify(data.messages),
        JSON.stringify(data.usage),
      );
  }

  loadSession(id: string): SessionData | null {
    const row = this.db
      .query<Record<string, string | number>, [string]>("select * from sessions where id = ?")
      .get(id);
    if (!row) return null;
    return {
      id: String(row.id),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      cwd: String(row.cwd),
      title: String(row.title),
      model: String(row.model),
      mode: String(row.mode),
      messages: JSON.parse(String(row.messages_json)) as ModelMessage[],
      usage: { ...EMPTY_USAGE, ...(JSON.parse(String(row.usage_json)) as Partial<UsageTotals>) },
    };
  }

  /**
   * Most-recent sessions, newest first. `cwd` scopes to one project: demi runs
   * in any repo but stores every session in one database, so an unscoped list
   * is other projects' history by default.
   */
  listSessions(limit = 20, cwd?: string): SessionMeta[] {
    const select = "select id, created_at, updated_at, cwd, title, model, mode from sessions";
    const rows = cwd
      ? this.db
          .query<Record<string, string | number>, [string, number]>(
            `${select} where cwd = ? order by updated_at desc limit ?`,
          )
          .all(cwd, limit)
      : this.db
          .query<Record<string, string | number>, [number]>(
            `${select} order by updated_at desc limit ?`,
          )
          .all(limit);
    return rows.map((row) => ({
      id: String(row.id),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      cwd: String(row.cwd),
      title: String(row.title),
      model: String(row.model),
      mode: String(row.mode),
    }));
  }

  /** Newest session, optionally within one project. Backs `demi resume` with no id. */
  latestSessionId(cwd?: string): string | null {
    const row = cwd
      ? this.db
          .query<{ id: string }, [string]>(
            "select id from sessions where cwd = ? order by updated_at desc limit 1",
          )
          .get(cwd)
      : this.db
          .query<{ id: string }, []>("select id from sessions order by updated_at desc limit 1")
          .get();
    return row?.id ?? null;
  }

  /** How many sessions exist outside `cwd` — lets the CLI say what it's hiding. */
  countSessionsElsewhere(cwd: string): number {
    const row = this.db
      .query<{ n: number }, [string]>("select count(*) as n from sessions where cwd != ?")
      .get(cwd);
    return row?.n ?? 0;
  }

  logDecision(d: DecisionEvent): void {
    this.db
      .query(
        `insert into decisions (session_id, step, ts, kind, summary, rationale, alternatives_json, refs_json, artifact_json)
         values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        d.sessionId,
        d.step,
        d.ts,
        d.kind,
        d.summary,
        d.rationale,
        d.alternatives ? JSON.stringify(d.alternatives) : null,
        JSON.stringify(d.refs),
        d.artifact ? JSON.stringify(d.artifact) : null,
      );
  }

  decisions(sessionId: string): DecisionEvent[] {
    const rows = this.db
      .query<Record<string, string | number | null>, [string]>(
        "select * from decisions where session_id = ? order by step asc, id asc",
      )
      .all(sessionId);
    return rows.map((row) => ({
      ts: Number(row.ts),
      sessionId: String(row.session_id),
      step: Number(row.step),
      kind: String(row.kind) as DecisionEvent["kind"],
      summary: String(row.summary),
      rationale: String(row.rationale),
      alternatives: row.alternatives_json
        ? (JSON.parse(String(row.alternatives_json)) as string[])
        : undefined,
      refs: JSON.parse(String(row.refs_json)) as string[],
      artifact: row.artifact_json
        ? (JSON.parse(String(row.artifact_json)) as DecisionEvent["artifact"])
        : undefined,
    }));
  }

  saveSnapshot(
    sessionId: string,
    step: number,
    path: string,
    existed: boolean,
    content: string | null,
  ): void {
    this.db
      .query(
        "insert into snapshots (session_id, step, ts, path, existed, content) values (?, ?, ?, ?, ?, ?)",
      )
      .run(sessionId, step, Date.now(), path, existed ? 1 : 0, content);
  }

  latestSnapshotStep(sessionId: string): number | null {
    const row = this.db
      .query<{ step: number }, [string]>(
        "select max(step) as step from snapshots where session_id = ?",
      )
      .get(sessionId);
    return row?.step ?? null;
  }

  snapshotsForStep(sessionId: string, step: number): SnapshotRow[] {
    const rows = this.db
      .query<Record<string, string | number | null>, [string, number]>(
        "select id, step, path, existed, content from snapshots where session_id = ? and step = ? order by id asc",
      )
      .all(sessionId, step);
    return rows.map((row) => ({
      id: Number(row.id),
      step: Number(row.step),
      path: String(row.path),
      existed: Number(row.existed) === 1,
      content: row.content === null ? null : String(row.content),
    }));
  }

  deleteSnapshotsForStep(sessionId: string, step: number): void {
    this.db.query("delete from snapshots where session_id = ? and step = ?").run(sessionId, step);
  }

  upsertConcept(c: Concept): void {
    this.db
      .query(
        `insert into concepts (slug, name, kind, example, first_seen, occurrences)
         values (?, ?, ?, ?, ?, ?)
         on conflict(slug) do update set
           occurrences = concepts.occurrences + 1,
           example = excluded.example`,
      )
      .run(c.slug, c.name, c.kind, c.example, c.firstSeen, c.occurrences);
  }

  concepts(): Concept[] {
    const rows = this.db
      .query<Record<string, string | number>, []>("select * from concepts order by first_seen desc")
      .all();
    return rows.map((row) => ({
      slug: String(row.slug),
      name: String(row.name),
      kind: String(row.kind) as Concept["kind"],
      example: String(row.example),
      firstSeen: Number(row.first_seen),
      occurrences: Number(row.occurrences),
    }));
  }

  close(): void {
    this.db.close();
  }
}
