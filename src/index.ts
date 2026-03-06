#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { AdbConfig } from "./adb.js";
import { registerTools } from "./tools.js";

const config: AdbConfig = {
  packageName: process.env.ANDROID_PACKAGE ?? "com.hortusys",
  device: process.env.ANDROID_DEVICE,
  adbPath: process.env.ADB_PATH,
};

const server = new McpServer({
  name: "android-sqlite-inspector",
  version: "1.0.0",
});

registerTools(server, config);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `Android SQLite Inspector MCP server running (package: ${config.packageName})`
  );
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
