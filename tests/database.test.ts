import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listTables, describeTable, query, execute } from "../src/database.js";

let dbPath: string;
let tmpDir: string;

before(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "db-test-"));
  dbPath = join(tmpDir, "test.db");

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT,
      age INTEGER DEFAULT 0
    );
    CREATE TABLE posts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      body TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
    INSERT INTO users (name, email, age) VALUES ('Alice', 'alice@example.com', 30);
    INSERT INTO users (name, email, age) VALUES ('Bob', 'bob@example.com', 25);
    INSERT INTO posts (user_id, title, body) VALUES (1, 'Hello', 'First post');
  `);
  db.close();
});

after(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("listTables", () => {
  it("returns all user-created tables", () => {
    const tables = listTables(dbPath);
    const names = tables.map((t) => t.name);
    assert.deepStrictEqual(names, ["posts", "users"]);
  });

  it("includes CREATE TABLE sql", () => {
    const tables = listTables(dbPath);
    const users = tables.find((t) => t.name === "users");
    assert.ok(users?.sql.includes("CREATE TABLE users"));
  });

  it("excludes sqlite internal tables", () => {
    const tables = listTables(dbPath);
    const internal = tables.filter((t) => t.name.startsWith("sqlite_"));
    assert.strictEqual(internal.length, 0);
  });
});

describe("describeTable", () => {
  it("returns columns for users table", () => {
    const columns = describeTable(dbPath, "users");
    assert.strictEqual(columns.length, 4);
    const names = columns.map((c) => c.name);
    assert.deepStrictEqual(names, ["id", "name", "email", "age"]);
  });

  it("includes type and constraint info", () => {
    const columns = describeTable(dbPath, "users");
    const nameCol = columns.find((c) => c.name === "name")!;
    assert.strictEqual(nameCol.type, "TEXT");
    assert.strictEqual(nameCol.notnull, 1);
  });

  it("shows primary key", () => {
    const columns = describeTable(dbPath, "users");
    const idCol = columns.find((c) => c.name === "id")!;
    assert.strictEqual(idCol.pk, 1);
  });

  it("shows default values", () => {
    const columns = describeTable(dbPath, "users");
    const ageCol = columns.find((c) => c.name === "age")!;
    assert.strictEqual(ageCol.dflt_value, "0");
  });

  it("throws for nonexistent table", () => {
    assert.throws(() => describeTable(dbPath, "nonexistent"), {
      message: "Table 'nonexistent' not found",
    });
  });
});

describe("query", () => {
  it("returns columns and rows for SELECT", () => {
    const result = query(dbPath, "SELECT id, name FROM users ORDER BY id");
    assert.deepStrictEqual(result.columns, ["id", "name"]);
    assert.strictEqual(result.rows.length, 2);
    assert.strictEqual(result.rows[0].name, "Alice");
    assert.strictEqual(result.rows[1].name, "Bob");
  });

  it("supports WHERE clause", () => {
    const result = query(dbPath, "SELECT name FROM users WHERE age > 26");
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].name, "Alice");
  });

  it("supports JOIN queries", () => {
    const result = query(
      dbPath,
      "SELECT u.name, p.title FROM users u JOIN posts p ON u.id = p.user_id"
    );
    assert.strictEqual(result.rows.length, 1);
    assert.strictEqual(result.rows[0].name, "Alice");
    assert.strictEqual(result.rows[0].title, "Hello");
  });

  it("returns empty rows for no matches", () => {
    const result = query(dbPath, "SELECT * FROM users WHERE age > 100");
    assert.strictEqual(result.rows.length, 0);
  });

  it("throws for non-SELECT statements", () => {
    assert.throws(
      () => query(dbPath, "DELETE FROM users WHERE id = 999"),
      { message: /Only SELECT queries are allowed/ }
    );
  });
});

describe("execute", () => {
  it("inserts a row and returns changes", () => {
    const result = execute(
      dbPath,
      "INSERT INTO users (name, email, age) VALUES ('Charlie', 'charlie@example.com', 35)"
    );
    assert.strictEqual(result.changes, 1);
    assert.ok(typeof result.lastInsertRowid === "number" || typeof result.lastInsertRowid === "bigint");
  });

  it("updates rows and returns change count", () => {
    const result = execute(
      dbPath,
      "UPDATE users SET age = 31 WHERE name = 'Alice'"
    );
    assert.strictEqual(result.changes, 1);
  });

  it("deletes rows and returns change count", () => {
    const result = execute(
      dbPath,
      "DELETE FROM users WHERE name = 'Charlie'"
    );
    assert.strictEqual(result.changes, 1);
  });

  it("returns 0 changes for no-match update", () => {
    const result = execute(
      dbPath,
      "UPDATE users SET age = 99 WHERE name = 'Nobody'"
    );
    assert.strictEqual(result.changes, 0);
  });
});
