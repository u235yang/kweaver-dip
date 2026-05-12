import type { Express } from "express";

import { loadStudioRuntimeConfigFromDatabase } from "./logic/studio-runtime-config";

/**
 * Fixed bind host used by the Studio MCP Server.
 *
 * Kubernetes Services connect through the Pod IP, so the server must not bind
 * only to loopback.
 */
const STUDIO_MCP_BIND_HOST = "0.0.0.0";

/**
 * Host advertised to the MCP Express app for locally generated endpoint
 * metadata.
 */
const STUDIO_MCP_APP_HOST = "127.0.0.1";

/**
 * Fixed port used by the Studio MCP Server.
 */
const STUDIO_MCP_PORT = 3001;

/**
 * Starts the Studio MCP Server.
 *
 * @param app Express application to serve.
 * @param port TCP port to bind.
 * @param host Host address to bind.
 * @returns The created Node.js HTTP server.
 */
export function startMcpServer(app: Express, port: number, host: string) {
  return app.listen(port, host, () => {
    console.log(`DIP Studio MCP Server listening on ${host}:${port}`);
  });
}

/**
 * Bootstraps the Studio MCP server.
 *
 * @returns The created Node.js HTTP server.
 */
export async function bootstrapMcpServer() {
  await loadStudioRuntimeConfigFromDatabase();
  const {
    createDefaultStudioMcpLogic,
    createStudioMcpApp,
    createStudioMcpServer
  } = await import("./mcp/app.js");
  const logic = createDefaultStudioMcpLogic();
  const app = createStudioMcpApp(() => createStudioMcpServer(logic), {
    host: STUDIO_MCP_APP_HOST
  });

  return startMcpServer(app, STUDIO_MCP_PORT, STUDIO_MCP_BIND_HOST);
}

void bootstrapMcpServer();
