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
