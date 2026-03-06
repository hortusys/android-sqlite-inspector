import Database from "better-sqlite3";
import { writeFileSync } from "node:fs";

export interface TableInfo {
  name: string;
  sql: string;
}

export interface ColumnInfo {
  cid: number;
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | null;
  pk: number;
}

export function listTables(dbPath: string): TableInfo[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all() as TableInfo[];
  } finally {
    db.close();
  }
}

export function describeTable(
  dbPath: string,
  tableName: string
): ColumnInfo[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    const table = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name = ?"
      )
      .get(tableName) as { name: string } | undefined;
    if (!table) {
      throw new Error(`Table '${tableName}' not found`);
    }
    return db.pragma(`table_info('${table.name}')`) as ColumnInfo[];
  } finally {
    db.close();
  }
}

export function query(
  dbPath: string,
  sql: string
): { columns: string[]; rows: Record<string, unknown>[] } {
  const db = new Database(dbPath, { readonly: true });
  try {
    const stmt = db.prepare(sql);
    if (!stmt.reader) {
      throw new Error(
        "Only SELECT queries are allowed. Use the 'execute' tool for modifications."
      );
    }
    const rows = stmt.all() as Record<string, unknown>[];
    const columns = stmt.columns().map((c) => c.name);
    return { columns, rows };
  } finally {
    db.close();
  }
}

export interface RoomInfo {
  version: number | null;
  identityHash: string | null;
  entities: string[];
}

const ROOM_INTERNAL_TABLES = new Set([
  "room_master_table",
  "android_metadata",
  "room_table_modification_log",
]);

export function roomInfo(dbPath: string): RoomInfo {
  const db = new Database(dbPath, { readonly: true });
  try {
    // Check if room_master_table exists
    const hasRoom = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='room_master_table'")
      .get();

    if (!hasRoom) {
      throw new Error("This database does not appear to be a Room database (no room_master_table found)");
    }

    const row = db
      .prepare("SELECT id, identity_hash FROM room_master_table LIMIT 1")
      .get() as { id: number; identity_hash: string } | undefined;

    // Get user entities (exclude Room internals and sqlite internals)
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];

    const entities = tables
      .map((t) => t.name)
      .filter((n) => !n.startsWith("sqlite_") && !n.startsWith("_") && !ROOM_INTERNAL_TABLES.has(n));

    return {
      version: row?.id ?? null,
      identityHash: row?.identity_hash ?? null,
      entities,
    };
  } finally {
    db.close();
  }
}

// --- Feature 5: Multi-query ---
export function multiQuery(
  dbPath: string,
  queries: string[]
): { columns: string[]; rows: Record<string, unknown>[] }[] {
  if (queries.length === 0) return [];
  const db = new Database(dbPath, { readonly: true });
  try {
    return queries.map((sql) => {
      const stmt = db.prepare(sql);
      if (!stmt.reader) {
        throw new Error(
          "Only SELECT queries are allowed. Use the 'execute' tool for modifications."
        );
      }
      const rows = stmt.all() as Record<string, unknown>[];
      const columns = stmt.columns().map((c) => c.name);
      return { columns, rows };
    });
  } finally {
    db.close();
  }
}

// --- Feature 6: Pagination ---
export function queryPaginated(
  dbPath: string,
  sql: string,
  opts: { limit: number; offset?: number }
): { columns: string[]; rows: Record<string, unknown>[]; totalCount: number } {
  const db = new Database(dbPath, { readonly: true });
  try {
    // Get total count by wrapping the query
    const countStmt = db.prepare(`SELECT COUNT(*) as cnt FROM (${sql})`);
    const totalCount = (countStmt.get() as { cnt: number }).cnt;

    const offset = opts.offset ?? 0;
    const paginatedSql = `${sql} LIMIT ${opts.limit} OFFSET ${offset}`;
    const stmt = db.prepare(paginatedSql);
    const rows = stmt.all() as Record<string, unknown>[];
    const columns = stmt.columns().map((c) => c.name);
    return { columns, rows, totalCount };
  } finally {
    db.close();
  }
}

// --- Feature 7: Schema diff ---
export interface SchemaMap {
  [tableName: string]: ColumnInfo[];
}

export interface TableDiff {
  table: string;
  addedColumns: string[];
  removedColumns: string[];
}

export interface SchemaDiffResult {
  addedTables: string[];
  removedTables: string[];
  modifiedTables: TableDiff[];
}

export function getSchema(dbPath: string): SchemaMap {
  const db = new Database(dbPath, { readonly: true });
  try {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all() as { name: string }[];

    const schema: SchemaMap = {};
    for (const { name } of tables) {
      schema[name] = db.pragma(`table_info('${name}')`) as ColumnInfo[];
    }
    return schema;
  } finally {
    db.close();
  }
}

export function schemaDiff(dbPathOld: string, dbPathNew: string): SchemaDiffResult {
  const oldSchema = getSchema(dbPathOld);
  const newSchema = getSchema(dbPathNew);

  const oldTables = new Set(Object.keys(oldSchema));
  const newTables = new Set(Object.keys(newSchema));

  const addedTables = [...newTables].filter((t) => !oldTables.has(t));
  const removedTables = [...oldTables].filter((t) => !newTables.has(t));

  const modifiedTables: TableDiff[] = [];
  for (const table of oldTables) {
    if (!newTables.has(table)) continue;
    const oldCols = new Set(oldSchema[table].map((c) => c.name));
    const newCols = new Set(newSchema[table].map((c) => c.name));
    const addedColumns = [...newCols].filter((c) => !oldCols.has(c));
    const removedColumns = [...oldCols].filter((c) => !newCols.has(c));
    if (addedColumns.length > 0 || removedColumns.length > 0) {
      modifiedTables.push({ table, addedColumns, removedColumns });
    }
  }

  return { addedTables, removedTables, modifiedTables };
}

// --- Feature 8: Export ---
function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportResult(
  result: { columns: string[]; rows: Record<string, unknown>[] },
  filePath: string,
  format: "json" | "csv"
): void {
  if (format === "json") {
    writeFileSync(filePath, JSON.stringify(result.rows, null, 2));
  } else {
    const header = result.columns.join(",");
    const rows = result.rows.map((row) =>
      result.columns.map((col) => csvEscape(row[col])).join(",")
    );
    writeFileSync(filePath, [header, ...rows].join("\n") + "\n");
  }
}

export function execute(
  dbPath: string,
  sql: string
): { changes: number; lastInsertRowid: number | bigint } {
  const db = new Database(dbPath, { readonly: false });
  try {
    const result = db.prepare(sql).run();
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  } finally {
    db.close();
  }
}
