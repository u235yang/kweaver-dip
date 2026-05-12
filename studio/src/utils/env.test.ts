import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  asMessage,
  getEnv,
  getOpenClawGatewayRuntimeConfig,
  getMcpEnv,
  getStudioDatabaseConfig,
  isDevelopmentMode,
  loadEnvFile,
  readOptionalString,
  resolveBknBackendUrl,
  resolveGatewayHttpUrl,
  resolveHydraAdminUrl,
  resolveLocalWorkspaceDir,
  resolvePositiveInteger,
  setStudioRuntimeConfig
} from "./env";

describe("env helpers", () => {
  it("converts non-Error values to strings", () => {
    expect(asMessage("boom")).toBe("boom");
    expect(asMessage(503)).toBe("503");
  });

  it("returns undefined for missing optional strings", () => {
    expect(readOptionalString(undefined)).toBeUndefined();
  });

  it("normalizes the BKN backend URL", () => {
    expect(resolveBknBackendUrl(undefined)).toBe("http://127.0.0.1:13014/");
    expect(resolveBknBackendUrl("https://example.com/api?x=1")).toBe(
      "https://example.com/"
    );
    expect(() => resolveBknBackendUrl("ftp://example.com")).toThrow(
      "KWEAVER_BASE_URL must use http or https protocol: ftp://example.com"
    );
  });

  it("normalizes the Hydra admin URL", () => {
    expect(resolveHydraAdminUrl(undefined)).toBe("http://127.0.0.1:4445/");
    expect(resolveHydraAdminUrl("https://example.com/admin?x=1")).toBe(
      "https://example.com/"
    );
    expect(() => resolveHydraAdminUrl("ftp://example.com")).toThrow(
      "KWEAVER_HYDRA_ADMIN_URL must use http or https protocol: ftp://example.com"
    );
  });

  it("rejects unsupported OpenClaw gateway HTTP URL protocols", () => {
    expect(() => resolveGatewayHttpUrl("ftp://gateway.example.com")).toThrow(
      "OPENCLAW_GATEWAY_URL must use ws, wss, http or https protocol: ftp://gateway.example.com"
    );
  });

  it("detects development mode from NODE_ENV", () => {
    expect(isDevelopmentMode("development")).toBe(true);
    expect(isDevelopmentMode("test")).toBe(false);
    expect(isDevelopmentMode(undefined)).toBe(false);
  });

  it("resolves positive integers", () => {
    expect(resolvePositiveInteger(undefined, 10, "TEST_VALUE")).toBe(10);
    expect(resolvePositiveInteger("12", 10, "TEST_VALUE")).toBe(12);
    expect(() => resolvePositiveInteger("0", 10, "TEST_VALUE")).toThrow(
      "Invalid TEST_VALUE value: 0"
    );
  });

  it("resolves OpenClaw workspace from OPENCLAW_HOST_PATH", () => {
    expect(resolveLocalWorkspaceDir("/data/.openclaw/")).toBe(
      join("/data/.openclaw", "workspace")
    );
    expect(() => resolveLocalWorkspaceDir(" ")).toThrow("OPENCLAW_HOST_PATH is required");
  });

  it("reloads the latest OpenClaw gateway config from a specific env file", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dip-studio-env-"));
    const envPath = join(tempDir, ".env");

    writeFileSync(
      envPath,
      [
        "OPENCLAW_GATEWAY_PROTOCOL=wss",
        "OPENCLAW_GATEWAY_HOST=gateway.example.com",
        "OPENCLAW_GATEWAY_PORT=29001",
        "OPENCLAW_GATEWAY_TOKEN=latest-token",
        "OPENCLAW_GATEWAY_TIMEOUT_MS=9000",
        "OPENCLAW_HOST_PATH=/data/.openclaw"
      ].join("\n"),
      "utf8"
    );

    try {
      const config = getOpenClawGatewayRuntimeConfig({
        path: envPath
      });

      expect(config).toEqual({
        url: "wss://gateway.example.com:29001/",
        httpUrl: "https://gateway.example.com:29001/",
        token: "latest-token",
        timeoutMs: 9000
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prefers cached Studio runtime config over process environment values", () => {
    setStudioRuntimeConfig({
      kweaverBaseUrl: "https://runtime-core.example.com",
      openClawGatewayUrl: "wss://runtime-gateway.example.com/ws",
      openClawGatewayToken: "runtime-token"
    });

    try {
      expect(getEnv()).toMatchObject({
        kweaverBaseUrl: "https://runtime-core.example.com/",
        openClawGatewayUrl: "wss://runtime-gateway.example.com/ws",
        openClawGatewayHttpUrl: "https://runtime-gateway.example.com/ws",
        openClawGatewayToken: "runtime-token"
      });
    } finally {
      setStudioRuntimeConfig(undefined);
    }
  });

  it("loads .env from the service working directory by default", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dip-studio-env-cwd-"));
    const previousCwd = process.cwd();
    const previousValue = process.env.DIP_STUDIO_CWD_ENV_TEST;
    writeFileSync(
      join(tempDir, ".env"),
      "DIP_STUDIO_CWD_ENV_TEST=from-cwd\n",
      "utf8"
    );

    try {
      delete process.env.DIP_STUDIO_CWD_ENV_TEST;
      process.chdir(tempDir);
      loadEnvFile({
        override: true,
        forceReload: true
      });

      expect(process.env.DIP_STUDIO_CWD_ENV_TEST).toBe("from-cwd");
    } finally {
      process.chdir(previousCwd);
      if (previousValue === undefined) {
        delete process.env.DIP_STUDIO_CWD_ENV_TEST;
      } else {
        process.env.DIP_STUDIO_CWD_ENV_TEST = previousValue;
      }
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("loads MCP settings from the service environment", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dip-studio-mcp-env-"));
    const envPath = join(tempDir, ".env");

    writeFileSync(envPath, ["MCP_HOST=0.0.0.0", "MCP_PORT=39001"].join("\n"), "utf8");

    try {
      loadEnvFile({
        path: envPath,
        override: true,
        forceReload: true
      });

      expect(getMcpEnv()).toEqual({
        host: "0.0.0.0",
        port: 39001
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("uses local MCP defaults", () => {
    const previousHost = process.env.MCP_HOST;
    const previousPort = process.env.MCP_PORT;

    try {
      delete process.env.MCP_HOST;
      delete process.env.MCP_PORT;

      expect(getMcpEnv()).toEqual({
        host: "127.0.0.1",
        port: 3001
      });
    } finally {
      if (previousHost === undefined) {
        delete process.env.MCP_HOST;
      } else {
        process.env.MCP_HOST = previousHost;
      }

      if (previousPort === undefined) {
        delete process.env.MCP_PORT;
      } else {
        process.env.MCP_PORT = previousPort;
      }
    }
  });

  it("loads Studio database settings from the service environment", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "dip-studio-db-env-"));
    const envPath = join(tempDir, ".env");

    writeFileSync(
      envPath,
      [
        "DB_HOST=db.example.com",
        "DB_PORT=3307",
        "DB_USER=studio",
        "DB_PASSWORD=secret",
        "DB_NAME=kweaver_test",
        "DB_CONNECTION_LIMIT=3"
      ].join("\n"),
      "utf8"
    );

    try {
      loadEnvFile({
        path: envPath,
        override: true,
        forceReload: true
      });

      expect(getStudioDatabaseConfig()).toEqual({
        host: "db.example.com",
        port: 3307,
        user: "studio",
        password: "secret",
        database: "kweaver_test",
        connectionLimit: 3
      });
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
