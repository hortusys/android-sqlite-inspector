# Android SQLite Inspector MCP Server — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a TypeScript MCP server that inspects and queries Android SQLite databases via ADB.

**Architecture:** Stdio-based MCP server with an ADB layer that pulls `.db` files from a debuggable Android app, and a database layer that queries them locally with `better-sqlite3`. Five tools: list_databases, list_tables, describe_table, query, execute.

**Tech Stack:** TypeScript, `@modelcontextprotocol/sdk` v2, `better-sqlite3`, `zod/v4`, Node.js `child_process`

---

### Task 1: Project scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`

**Step 1: Initialize package.json**

```bash
cd /Users/andromeda/StudioProjects/android-sqlite-inspector
npm init -y
```

**Step 2: Install dependencies**

```bash
npm install @modelcontextprotocol/server better-sqlite3 zod
npm install -D typescript @types/node @types/better-sqlite3
```

**Step 3: Create tsconfig.json**

Create `tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

**Step 4: Update package.json scripts and type**

Add to `package.json`:
```json
{
  "type": "module",
  "bin": { "android-sqlite-inspector": "./dist/index.js" },
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

**Step 5: Create src directory**

```bash
mkdir -p src
```

**Step 6: Commit**

```bash
git init
git add package.json tsconfig.json package-lock.json
git commit -m "chore: scaffold project with dependencies"
```

---

### Task 2: ADB interaction layer

**Files:**
- Create: `src/adb.ts`

**Step 1: Implement src/adb.ts**

This module wraps ADB commands. Key functions:
- `listDatabases(packageName)` — runs `adb shell run-as <pkg> ls databases/` and parses output
- `pullDatabase(packageName, dbName)` — runs `adb shell run-as <pkg> cat databases/<dbName>` piped to a temp file, returns the temp file path
- `pushDatabase(packageName, dbName, localPath)` — pushes a modified db back to the device

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const execFileAsync = promisify(execFile);

export interface AdbConfig {
  packageName: string;
  device?: string;
  adbPath?: string;
}

function adbArgs(config: AdbConfig, ...args: string[]): string[] {
  const result: string[] = [];
  if (config.device) {
    result.push("-s", config.device);
  }
  result.push(...args);
  return result;
}

function adb(config: AdbConfig) {
  return config.adbPath ?? "adb";
}

export async function listDatabases(config: AdbConfig): Promise<string[]> {
  const { stdout } = await execFileAsync(
    adb(config),
    adbArgs(config, "shell", "run-as", config.packageName, "ls", "databases/")
  );
  return stdout
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.endsWith(".db"));
}

export async function pullDatabase(
  config: AdbConfig,
  dbName: string
): Promise<string> {
  const { stdout } = await execFileAsync(
    adb(config),
    adbArgs(
      config,
      "shell",
      "run-as",
      config.packageName,
      "cat",
      `databases/${dbName}`
    ),
    { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 }
  );
  const dir = await mkdtemp(join(tmpdir(), "sqlite-inspector-"));
  const filePath = join(dir, dbName);
  await writeFile(filePath, stdout);
  return filePath;
}

export async function pushDatabase(
  config: AdbConfig,
  dbName: string,
  localPath: string
): Promise<void> {
  // Push via: adb shell run-as <pkg> sh -c 'cat > databases/<db>' < localFile
  // We use a two-step approach: push to /data/local/tmp, then copy via run-as
  const tmpRemote = `/data/local/tmp/${dbName}`;
  await execFileAsync(adb(config), adbArgs(config, "push", localPath, tmpRemote));
  await execFileAsync(
    adb(config),
    adbArgs(
      config,
      "shell",
      "run-as",
      config.packageName,
      "cp",
      tmpRemote,
      `databases/${dbName}`
    )
  );
  await execFileAsync(adb(config), adbArgs(config, "shell", "rm", tmpRemote));
}
```

**Step 2: Commit**

```bash
git add src/adb.ts
git commit -m "feat: add ADB interaction layer"
```

---

### Task 3: Database query layer

**Files:**
- Create: `src/database.ts`

**Step 1: Implement src/database.ts**

This module operates on a local `.db` file pulled via ADB.

```typescript
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
    // Validate table name exists to prevent injection
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
```

**Step 2: Commit**

```bash
git add src/database.ts
git commit -m "feat: add database query layer"
```

---

### Task 4: MCP tool definitions

**Files:**
- Create: `src/tools.ts`

**Step 1: Implement src/tools.ts**

Register all five tools on the MCP server using `server.registerTool()` with Zod v4 schemas.

```typescript
import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { AdbConfig } from "./adb.js";
import { listDatabases, pullDatabase, pushDatabase } from "./adb.js";
import * as db from "./database.js";

export function registerTools(server: McpServer, config: AdbConfig): void {
  // 1. list_databases
  server.registerTool(
    "list_databases",
    {
      title: "List Databases",
      description: `List all SQLite database files for the Android app (${config.packageName})`,
      inputSchema: z.object({}),
    },
    async () => {
      const databases = await listDatabases(config);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({ databases }, null, 2),
          },
        ],
      };
    }
  );

  // 2. list_tables
  server.registerTool(
    "list_tables",
    {
      title: "List Tables",
      description:
        "List all tables in a SQLite database. Pulls a fresh copy from the device.",
      inputSchema: z.object({
        database: z.string().describe("Database filename (e.g. app.db)"),
      }),
    },
    async ({ database }) => {
      const dbPath = await pullDatabase(config, database);
      const tables = db.listTables(dbPath);
      return {
        content: [{ type: "text", text: JSON.stringify({ tables }, null, 2) }],
      };
    }
  );

  // 3. describe_table
  server.registerTool(
    "describe_table",
    {
      title: "Describe Table",
      description:
        "Show the schema (columns, types, constraints) for a specific table.",
      inputSchema: z.object({
        database: z.string().describe("Database filename (e.g. app.db)"),
        table: z.string().describe("Table name"),
      }),
    },
    async ({ database, table }) => {
      const dbPath = await pullDatabase(config, database);
      const columns = db.describeTable(dbPath, table);
      return {
        content: [
          { type: "text", text: JSON.stringify({ table, columns }, null, 2) },
        ],
      };
    }
  );

  // 4. query (read)
  server.registerTool(
    "query",
    {
      title: "Query Database",
      description:
        "Execute a read-only SQL SELECT query. Returns results as JSON. Pulls a fresh copy from the device before querying.",
      inputSchema: z.object({
        database: z.string().describe("Database filename (e.g. app.db)"),
        sql: z.string().describe("SQL SELECT query to execute"),
      }),
    },
    async ({ database, sql }) => {
      const dbPath = await pullDatabase(config, database);
      const result = db.query(dbPath, sql);
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  // 5. execute (write)
  server.registerTool(
    "execute",
    {
      title: "Execute SQL",
      description:
        "Execute an INSERT, UPDATE, or DELETE SQL statement. Pulls the database, modifies it locally, then pushes it back to the device.",
      inputSchema: z.object({
        database: z.string().describe("Database filename (e.g. app.db)"),
        sql: z.string().describe("SQL statement to execute (INSERT/UPDATE/DELETE)"),
      }),
    },
    async ({ database, sql }) => {
      const dbPath = await pullDatabase(config, database);
      const result = db.execute(dbPath, sql);
      await pushDatabase(config, database, dbPath);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                changes: result.changes,
                lastInsertRowid: Number(result.lastInsertRowid),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );
}
```

**Step 2: Commit**

```bash
git add src/tools.ts
git commit -m "feat: register MCP tools for CRUD operations"
```

---

### Task 5: Server entry point

**Files:**
- Create: `src/index.ts`

**Step 1: Implement src/index.ts**

```typescript
#!/usr/bin/env node
import { McpServer, StdioServerTransport } from "@modelcontextprotocol/server";
import type { AdbConfig } from "./adb.js";
import { registerTools } from "./tools.js";

const config: AdbConfig = {
  packageName: process.env.ANDROID_PACKAGE ?? "com.hortusys",
  device: process.env.ANDROID_DEVICE,
  adbPath: process.env.ADB_PATH,
};

const server = new McpServer({
  name: "android-sqlite-inspector",
  version: "1.0.0",
});

registerTools(server, config);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Android SQLite Inspector MCP server running (package: ${config.packageName})`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
```

**Step 2: Build and verify**

```bash
npm run build
```

Expected: Compiles to `dist/` with no errors.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add MCP server entry point"
```

---

### Task 6: Build, test, and document

**Files:**
- Modify: `package.json` (verify bin field points to correct path)
- Create: `README.md`

**Step 1: Full build**

```bash
npm run build
```

**Step 2: Smoke test — verify server starts**

```bash
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0.1"}}}' | node dist/index.js 2>/dev/null | head -c 500
```

Expected: JSON response with server capabilities.

**Step 3: Create README.md**

Create `README.md` with:
- What the server does
- Prerequisites (Node.js, ADB, debuggable Android app)
- Installation: `npm install && npm run build`
- Configuration via env vars: `ANDROID_PACKAGE`, `ANDROID_DEVICE`, `ADB_PATH`
- Claude Code MCP config example for `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "android-sqlite-inspector": {
      "command": "node",
      "args": ["/Users/andromeda/StudioProjects/android-sqlite-inspector/dist/index.js"],
      "env": {
        "ANDROID_PACKAGE": "com.hortusys"
      }
    }
  }
}
```

- Available tools with descriptions

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: add README and finalize build"
```
