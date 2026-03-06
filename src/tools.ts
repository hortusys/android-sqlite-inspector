import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";
import type { AdbConfig } from "./adb.js";
import { listDatabases, pullDatabase, pullDatabaseCached, pushDatabase, invalidateCache, friendlyError, listDevices, listPackages } from "./adb.js";
import * as db from "./database.js";

function errorResult(err: unknown) {
  return {
    isError: true as const,
    content: [{ type: "text" as const, text: friendlyError(err) }],
  };
}

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
      try {
        const databases = await listDatabases(config);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ databases }, null, 2),
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
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
      try {
        const dbPath = await pullDatabaseCached(config, database);
        const tables = db.listTables(dbPath);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ tables }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
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
      try {
        const dbPath = await pullDatabaseCached(config, database);
        const columns = db.describeTable(dbPath, table);
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ table, columns }, null, 2) },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
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
      try {
        const dbPath = await pullDatabaseCached(config, database);
        const result = db.query(dbPath, sql);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
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
      try {
        const dbPath = await pullDatabase(config, database);
        const result = db.execute(dbPath, sql);
        await pushDatabase(config, database, dbPath);
        invalidateCache(database);
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
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 6. room_info
  server.registerTool(
    "room_info",
    {
      title: "Room Database Info",
      description:
        "Show Room database metadata: schema version, identity hash, and managed entities.",
      inputSchema: z.object({
        database: z.string().describe("Database filename (e.g. app.db)"),
      }),
    },
    async ({ database }) => {
      try {
        const dbPath = await pullDatabaseCached(config, database);
        const info = db.roomInfo(dbPath);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(info, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 7. multi_query
  server.registerTool(
    "multi_query",
    {
      title: "Multi Query",
      description:
        "Execute multiple read-only SQL SELECT queries in a single call. More efficient than calling query multiple times.",
      inputSchema: z.object({
        database: z.string().describe("Database filename (e.g. app.db)"),
        queries: z.array(z.string()).describe("Array of SQL SELECT queries"),
      }),
    },
    async ({ database, queries }) => {
      try {
        const dbPath = await pullDatabaseCached(config, database);
        const results = db.multiQuery(dbPath, queries);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 8. query_paginated
  server.registerTool(
    "query_paginated",
    {
      title: "Query with Pagination",
      description:
        "Execute a SELECT query with LIMIT/OFFSET pagination. Returns results plus total row count.",
      inputSchema: z.object({
        database: z.string().describe("Database filename (e.g. app.db)"),
        sql: z.string().describe("SQL SELECT query"),
        limit: z.number().describe("Maximum rows to return"),
        offset: z.number().optional().describe("Number of rows to skip (default 0)"),
      }),
    },
    async ({ database, sql, limit, offset }) => {
      try {
        const dbPath = await pullDatabaseCached(config, database);
        const result = db.queryPaginated(dbPath, sql, { limit, offset });
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 9. schema_diff
  server.registerTool(
    "schema_diff",
    {
      title: "Schema Diff",
      description:
        "Compare schemas of two databases. Shows added/removed tables and columns.",
      inputSchema: z.object({
        database_old: z.string().describe("Old database filename"),
        database_new: z.string().describe("New database filename"),
      }),
    },
    async ({ database_old, database_new }) => {
      try {
        const oldPath = await pullDatabaseCached(config, database_old);
        const newPath = await pullDatabaseCached(config, database_new);
        const diff = db.schemaDiff(oldPath, newPath);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(diff, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 10. export
  server.registerTool(
    "export",
    {
      title: "Export Query Results",
      description:
        "Execute a SELECT query and export results to a local file as JSON or CSV.",
      inputSchema: z.object({
        database: z.string().describe("Database filename (e.g. app.db)"),
        sql: z.string().describe("SQL SELECT query"),
        file_path: z.string().describe("Local file path to write results to"),
        format: z.enum(["json", "csv"]).describe("Output format: json or csv"),
      }),
    },
    async ({ database, sql, file_path, format }) => {
      try {
        const dbPath = await pullDatabaseCached(config, database);
        const result = db.query(dbPath, sql);
        db.exportResult(result, file_path, format);
        return {
          content: [
            {
              type: "text" as const,
              text: `Exported ${result.rows.length} rows to ${file_path} (${format})`,
            },
          ],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 11. list_devices
  server.registerTool(
    "list_devices",
    {
      title: "List Connected Devices",
      description: "List all Android devices/emulators connected via ADB.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const devices = await listDevices(config);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ devices }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 12. list_packages
  server.registerTool(
    "list_packages",
    {
      title: "List Installed Packages",
      description:
        "List third-party packages installed on the device. Useful for finding the correct package name.",
      inputSchema: z.object({}),
    },
    async () => {
      try {
        const packages = await listPackages(config);
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ packages }, null, 2) }],
        };
      } catch (err) {
        return errorResult(err);
      }
    }
  );

  // 13. Resource: database schema
  server.registerResource(
    "database-schema",
    new ResourceTemplate("sqlite://{database}/schema", {
      list: async () => {
        try {
          const databases = await listDatabases(config);
          return {
            resources: databases.map((name) => ({
              uri: `sqlite://${name}/schema`,
              name: `${name} schema`,
            })),
          };
        } catch {
          return { resources: [] };
        }
      },
    }),
    {
      title: "Database Schema",
      description: "Full schema for an Android SQLite database",
      mimeType: "application/json",
    },
    async (uri, { database }) => {
      try {
        const dbPath = await pullDatabaseCached(config, database as string);
        const schema = db.getSchema(dbPath);
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(schema, null, 2),
            },
          ],
        };
      } catch {
        return { contents: [] };
      }
    }
  );
}
