# Android SQLite Inspector MCP Server — Design

## Overview

A TypeScript MCP server that connects to an Android device/emulator via ADB, pulls SQLite database files from a debuggable app, and exposes them for querying. Focused on read operations with full CRUD support.

## Tools

| Tool | Description |
|------|-------------|
| `list_databases` | Lists all `.db` files in the app's databases directory |
| `list_tables` | Lists all tables in a given database |
| `describe_table` | Shows schema (columns, types, constraints) for a table |
| `query` | Executes a raw SQL SELECT query, returns results as JSON |
| `execute` | Executes INSERT/UPDATE/DELETE SQL, returns affected row count |

## How It Works

1. Server is configured with the app's package name (default: `com.hortusys`)
2. On each read operation, runs `adb shell run-as <package> cat databases/<db>` to pull a fresh copy to a temp file
3. Uses `better-sqlite3` to query the local copy
4. For write operations (`execute`), pulls -> modifies locally -> pushes back via ADB

## Tech Stack

- TypeScript + `@modelcontextprotocol/sdk`
- `better-sqlite3` for SQLite access
- Node `child_process` for ADB commands

## Configuration

- `package` — Android app package name (env var or arg)
- `device` — optional ADB device serial (for multiple devices)
- `adb_path` — optional custom ADB path

## Project Structure

```
android-sqlite-inspector/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts          # MCP server entry point
│   ├── adb.ts            # ADB interaction layer
│   ├── database.ts       # SQLite query logic
│   └── tools.ts          # MCP tool definitions
└── README.md
```
