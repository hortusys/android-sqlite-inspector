# Android SQLite Inspector

MCP server that inspects and queries SQLite databases on Android devices via ADB.

## Prerequisites

- Node.js 18+
- ADB installed and in PATH
- A **debuggable** Android app (debug builds)

## Installation

```bash
npm install
npm run build
```

## Configuration

Set via environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `ANDROID_PACKAGE` | App package name | `com.hortusys` |
| `ANDROID_DEVICE` | ADB device serial (for multiple devices) | _(auto-detect)_ |
| `ADB_PATH` | Custom path to ADB binary | `adb` |

## Claude Code Setup

Add to `~/.claude/settings.json`:

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

## Available Tools

| Tool | Description |
|------|-------------|
| `list_databases` | List all `.db` files in the app's databases directory |
| `list_tables` | List all tables in a database |
| `describe_table` | Show column schema for a table |
| `query` | Execute a SELECT query (returns JSON) |
| `execute` | Execute INSERT/UPDATE/DELETE (pushes changes back to device) |

## How It Works

1. Each read operation pulls a fresh copy of the database from the device via `adb shell run-as <package> cat databases/<db>`
2. Queries run locally using `better-sqlite3`
3. Write operations (`execute`) pull the db, modify locally, then push back via ADB
