import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { adbArgs, friendlyError, type AdbConfig } from "../src/adb.js";

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

describe("friendlyError", () => {
  it("maps 'no devices' to friendly message", () => {
    const err = new Error("no devices/emulators found");
    assert.strictEqual(friendlyError(err), "No Android device connected. Run `adb devices` to check.");
  });

  it("maps 'device offline' to friendly message", () => {
    const err = new Error("error: device offline");
    assert.strictEqual(friendlyError(err), "Device is offline. Reconnect and try again.");
  });

  it("maps 'not debuggable' to friendly message", () => {
    const err = Object.assign(new Error("Command failed"), { stderr: "run-as: package is not debuggable" });
    assert.strictEqual(friendlyError(err), "App is not debuggable. Use a debug build.");
  });

  it("maps unknown package to friendly message", () => {
    const err = Object.assign(new Error("Command failed"), { stderr: "Package 'com.foo' is unknown" });
    assert.strictEqual(friendlyError(err), "Package not found on device. Is the app installed?");
  });

  it("maps missing adb to friendly message", () => {
    const err = new Error("ENOENT: adb not found");
    assert.strictEqual(friendlyError(err), "ADB not found. Install Android SDK platform-tools and ensure `adb` is in PATH.");
  });

  it("returns original message for unknown errors", () => {
    const err = new Error("something unexpected");
    assert.strictEqual(friendlyError(err), "something unexpected");
  });

  it("handles non-Error values", () => {
    assert.strictEqual(friendlyError("plain string error"), "plain string error");
  });
});
