# High-Value Improvements Design

## 1. WAL Mode Support

Pull `.db-wal` and `.db-shm` alongside `.db` so Room's WAL data is included. better-sqlite3 reads WAL automatically when all 3 files are co-located.

## 2. Database Caching

Cache pulled databases in a Map with 5s TTL. Read tools reuse cache; execute invalidates after push. TTL configurable via `CACHE_TTL_MS` env var.

## 3. Error Handling

Wrap ADB calls with friendly error messages for: no device, not debuggable, no databases found, device offline. Tools return `isError: true` MCP responses instead of crashing.

## 4. Room Metadata Tool

New `room_info` tool reads `room_master_table` for schema version/identity hash. Lists Room-managed entities excluding internal tables.
