import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adbArgs, type AdbConfig } from "../src/adb.js";

describe("adbArgs", () => {
  it("returns args without device flag when no device specified", () => {
    const config: AdbConfig = { packageName: "com.example" };
    const result = adbArgs(config, "shell", "ls");
    assert.deepStrictEqual(result, ["shell", "ls"]);
  });

  it("prepends -s device when device is specified", () => {
    const config: AdbConfig = { packageName: "com.example", device: "emulator-5554" };
    const result = adbArgs(config, "shell", "ls");
    assert.deepStrictEqual(result, ["-s", "emulator-5554", "shell", "ls"]);
  });

  it("handles empty extra args", () => {
    const config: AdbConfig = { packageName: "com.example" };
    const result = adbArgs(config);
    assert.deepStrictEqual(result, []);
  });

  it("handles device with no extra args", () => {
    const config: AdbConfig = { packageName: "com.example", device: "abc123" };
    const result = adbArgs(config);
    assert.deepStrictEqual(result, ["-s", "abc123"]);
  });
});
