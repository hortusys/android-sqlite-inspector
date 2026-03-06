import { McpServer } from "@modelcontextprotocol/sdk/server";
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
            type: "text" as const,
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
        content: [{ type: "text" as const, text: JSON.stringify({ tables }, null, 2) }],
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
          { type: "text" as const, text: JSON.stringify({ table, columns }, null, 2) },
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
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
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
            type: "text" as const,
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
