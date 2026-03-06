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

export function adbArgs(config: AdbConfig, ...args: string[]): string[] {
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

async function pullFile(
  config: AdbConfig,
  remotePath: string,
  localPath: string
): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync(
      adb(config),
      adbArgs(config, "shell", "run-as", config.packageName, "cat", remotePath),
      { encoding: "buffer", maxBuffer: 100 * 1024 * 1024 }
    );
    await writeFile(localPath, stdout);
    return true;
  } catch {
    return false;
  }
}

export async function pullDatabase(
  config: AdbConfig,
  dbName: string
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "sqlite-inspector-"));
  const filePath = join(dir, dbName);

  const pulled = await pullFile(config, `databases/${dbName}`, filePath);
  if (!pulled) {
    throw new Error(`Failed to pull database '${dbName}' from device`);
  }

  // Pull WAL and SHM files (Room uses WAL by default)
  await pullFile(config, `databases/${dbName}-wal`, `${filePath}-wal`);
  await pullFile(config, `databases/${dbName}-shm`, `${filePath}-shm`);

  return filePath;
}

// --- Pull cache ---
interface CacheEntry {
  path: string;
  pulledAt: number;
}

const pullCache = new Map<string, CacheEntry>();

const DEFAULT_CACHE_TTL_MS = 5000;

function getCacheTtl(): number {
  const env = process.env.CACHE_TTL_MS;
  return env ? parseInt(env, 10) : DEFAULT_CACHE_TTL_MS;
}

export async function pullDatabaseCached(
  config: AdbConfig,
  dbName: string
): Promise<string> {
  const key = `${config.packageName}:${dbName}`;
  const cached = pullCache.get(key);
  const now = Date.now();
  if (cached && now - cached.pulledAt < getCacheTtl()) {
    return cached.path;
  }
  const path = await pullDatabase(config, dbName);
  pullCache.set(key, { path, pulledAt: Date.now() });
  return path;
}

export function invalidateCache(dbName?: string): void {
  if (dbName) {
    for (const key of pullCache.keys()) {
      if (key.endsWith(`:${dbName}`)) {
        pullCache.delete(key);
      }
    }
  } else {
    pullCache.clear();
  }
}

export async function pushDatabase(
  config: AdbConfig,
  dbName: string,
  localPath: string
): Promise<void> {
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

// --- Feature 10: Device listing ---
export interface DeviceInfo {
  serial: string;
  state: string;
}

export function parseDeviceList(output: string): DeviceInfo[] {
  return output
    .split("\n")
    .slice(1) // skip "List of devices attached" header
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const [serial, state] = line.split("\t");
      return { serial, state };
    });
}

export async function listDevices(config: AdbConfig): Promise<DeviceInfo[]> {
  const { stdout } = await execFileAsync(adb(config), ["devices"]);
  return parseDeviceList(stdout);
}

// --- Feature 9: Package listing ---
export function parsePackageList(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("package:"))
    .map((line) => line.replace("package:", ""));
}

export async function listPackages(config: AdbConfig): Promise<string[]> {
  const { stdout } = await execFileAsync(
    adb(config),
    adbArgs(config, "shell", "pm", "list", "packages", "-3")
  );
  return parsePackageList(stdout);
}

// --- Error mapping ---
const ERROR_PATTERNS: Array<{ pattern: RegExp; message: string }> = [
  { pattern: /no devices\/emulators found|device not found/i, message: "No Android device connected. Run `adb devices` to check." },
  { pattern: /device offline/i, message: "Device is offline. Reconnect and try again." },
  { pattern: /not debuggable|is not debuggable/i, message: "App is not debuggable. Use a debug build." },
  { pattern: /Package '.*' is unknown|Unknown package/i, message: "Package not found on device. Is the app installed?" },
  { pattern: /No such file or directory.*databases/i, message: "No databases found for this package." },
  { pattern: /ENOENT.*adb/i, message: "ADB not found. Install Android SDK platform-tools and ensure `adb` is in PATH." },
];

export function friendlyError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const stderr = (err as { stderr?: string })?.stderr ?? "";
  const combined = `${msg} ${stderr}`;
  for (const { pattern, message } of ERROR_PATTERNS) {
    if (pattern.test(combined)) {
      return message;
    }
  }
  return msg;
}
