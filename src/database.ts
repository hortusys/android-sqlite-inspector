import Database from "better-sqlite3";

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
