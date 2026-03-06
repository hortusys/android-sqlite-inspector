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
