import { join } from "node:path";

import { config as loadDotEnvConfig } from "dotenv";

import type { StudioDatabaseConfig } from "../infra/mariadb-client";

let hasLoadedDotEnv = false;

/**
 * Describes the options used to load an environment file.
 */
export interface LoadEnvFileOptions {
  /**
   * Explicit path to the environment file.
   */
  path?: string;

  /**
   * Replaces existing `process.env` values when true.
   */
  override?: boolean;

  /**
   * Forces the loader to run again even if it already executed once.
   */
  forceReload?: boolean;
}

/**
 * Describes the OpenClaw Gateway connection settings used by runtime clients.
 */
export interface OpenClawGatewayRuntimeConfig {
  /**
   * OpenClaw Gateway WebSocket URL.
   */
  url: string;

  /**
   * OpenClaw Gateway HTTP base URL.
   */
  httpUrl: string;

  /**
   * Optional bearer token used for upstream authentication.
   */
  token?: string;

  /**
   * Upstream timeout in milliseconds.
   */
  timeoutMs: number;
}

/**
 * Studio platform connection configuration cached from RDS.
 */
export interface StudioRuntimeConfig {
  /**
   * KWeaver service base URL.
   */
  kweaverBaseUrl: string;

  /**
   * OpenClaw gateway WebSocket URL.
   */
  openClawGatewayUrl: string;

  /**
   * OpenClaw gateway token.
   */
  openClawGatewayToken: string;
}

let studioRuntimeConfig: StudioRuntimeConfig | undefined;

/**
 * Updates the in-memory Studio runtime configuration cache.
 *
 * @param config Studio connection configuration loaded from RDS.
 */
export function setStudioRuntimeConfig(config: StudioRuntimeConfig | undefined): void {
  studioRuntimeConfig = config;
}

/**
 * Reads the in-memory Studio runtime configuration cache.
 *
 * @returns The cached Studio connection configuration when present.
 */
export function getStudioRuntimeConfig(): StudioRuntimeConfig | undefined {
  return studioRuntimeConfig;
}

/**
 * Resolves the HTTP port from an environment variable.
 *
 * @param value The raw environment variable value.
 * @returns A validated TCP port number.
 * @throws {Error} Thrown when the port is not a positive integer.
 */
export function resolvePort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 3000;
  }

  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid PORT value: ${value}`);
  }

  return port;
}

/**
 * Reads and validates runtime environment variables.
 *
 * @returns The normalized runtime configuration.
 */
export function getEnv(): {
  port: number;
  bknBackendUrl: string;
  kweaverBaseUrl: string;
  appUserToken?: string;
  hydraAdminUrl: string;
  isDevelopment: boolean;
  oauthMockUserId?: string;
  openClawGatewayUrl: string;
  openClawGatewayHttpUrl: string;
  openClawGatewayToken?: string;
  openClawGatewayTimeoutMs: number;
  openClawLocalWorkspaceDir: string;
} {
  loadEnvFile();

  const gatewayProtocol = resolveGatewayProtocol(
    process.env.OPENCLAW_GATEWAY_PROTOCOL
  );
  const gatewayHost = resolveGatewayHost(process.env.OPENCLAW_GATEWAY_HOST);
  const gatewayPort = resolveGatewayPort(process.env.OPENCLAW_GATEWAY_PORT);
  const gatewayUrl =
    studioRuntimeConfig?.openClawGatewayUrl ??
    readOptionalString(process.env.OPENCLAW_GATEWAY_URL) ??
    buildGatewayUrl(gatewayProtocol, gatewayHost, gatewayPort);

  const kweaverBaseUrl = resolveBknBackendUrl(
    studioRuntimeConfig?.kweaverBaseUrl ?? process.env.KWEAVER_BASE_URL
  );

  return {
    port: resolvePort(process.env.PORT),
    bknBackendUrl: kweaverBaseUrl,
    kweaverBaseUrl,
    appUserToken: readOptionalString(process.env.KWEAVER_TOKEN),
    hydraAdminUrl: resolveHydraAdminUrl(process.env.KWEAVER_HYDRA_ADMIN_URL),
    isDevelopment: isDevelopmentMode(process.env.NODE_ENV),
    oauthMockUserId: readOptionalString(process.env.OAUTH_MOCK_USER_ID),
    openClawGatewayUrl: gatewayUrl,
    openClawGatewayHttpUrl: resolveGatewayHttpUrl(gatewayUrl),
    openClawGatewayToken:
      studioRuntimeConfig?.openClawGatewayToken ??
      readOptionalString(process.env.OPENCLAW_GATEWAY_TOKEN),
    openClawGatewayTimeoutMs: resolveTimeoutMs(process.env.OPENCLAW_GATEWAY_TIMEOUT_MS),
    openClawLocalWorkspaceDir: resolveLocalWorkspaceDir()
  };
}

/**
 * Reads and validates Studio MCP Server runtime settings.
 *
 * @returns The normalized MCP host and port.
 */
export function getMcpEnv(): {
  host: string;
  port: number;
} {
  loadEnvFile();

  return {
    host: readOptionalString(process.env.MCP_HOST) ?? "127.0.0.1",
    port: resolvePositiveInteger(process.env.MCP_PORT, 3001, "MCP_PORT")
  };
}

/**
 * Reads and validates Studio MariaDB connection settings.
 *
 * @returns The normalized Studio database configuration.
 */
export function getStudioDatabaseConfig(): StudioDatabaseConfig {
  loadEnvFile();

  return {
    host: readOptionalString(process.env.DB_HOST) ?? "127.0.0.1",
    port: resolvePositiveInteger(process.env.DB_PORT, 3306, "DB_PORT"),
    user: readOptionalString(process.env.DB_USER) ?? "root",
    password: readOptionalString(process.env.DB_PASSWORD),
    database: readOptionalString(process.env.DB_NAME) ?? "kweaver",
    connectionLimit: resolvePositiveInteger(
      process.env.DB_CONNECTION_LIMIT,
      10,
      "DB_CONNECTION_LIMIT"
    )
  };
}

/**
 * Reloads `.env` and returns the latest OpenClaw Gateway connection settings.
 *
 * @param options Optional env-file loading overrides used by tests.
 * @returns The normalized OpenClaw runtime configuration.
 */
export function getOpenClawGatewayRuntimeConfig(
  options: LoadEnvFileOptions = {}
): OpenClawGatewayRuntimeConfig {
  loadEnvFile({
    ...options,
    override: options.override ?? true,
    forceReload: options.forceReload ?? true
  });

  const env = getEnv();

  return {
    url: env.openClawGatewayUrl,
    httpUrl: env.openClawGatewayHttpUrl,
    token: env.openClawGatewayToken,
    timeoutMs: env.openClawGatewayTimeoutMs
  };
}

/**
 * Loads variables from a local environment file once.
 *
 * @param options Optional loading behavior for tests and alternate env files.
 * Defaults to `.env` under the service process working directory.
 */
export function loadEnvFile(options: LoadEnvFileOptions = {}): void {
  if (hasLoadedDotEnv && options.forceReload !== true) {
    return;
  }

  loadDotEnvConfig({
    path: options.path ?? join(process.cwd(), ".env"),
    override: options.override,
    quiet: true
  });

  hasLoadedDotEnv = true;
}

/**
 * Resolves the OpenClaw gateway protocol.
 *
 * @param value The raw environment variable value.
 * @returns A validated gateway protocol.
 * @throws {Error} Thrown when the protocol is unsupported.
 */
export function resolveGatewayProtocol(value: string | undefined): "ws" | "wss" {
  const protocol = readOptionalString(value) ?? "ws";

  if (protocol !== "ws" && protocol !== "wss") {
    throw new Error(`Invalid OPENCLAW_GATEWAY_PROTOCOL value: ${value ?? ""}`);
  }

  return protocol;
}

/**
 * Resolves the OpenClaw gateway host.
 *
 * @param value The raw environment variable value.
 * @returns A validated gateway host.
 */
export function resolveGatewayHost(value: string | undefined): string {
  return readOptionalString(value) ?? "127.0.0.1";
}

/**
 * Resolves the OpenClaw gateway port.
 *
 * @param value The raw environment variable value.
 * @returns A validated gateway port.
 * @throws {Error} Thrown when the port is not a positive integer.
 */
export function resolveGatewayPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 19_001;
  }

  const port = Number.parseInt(value, 10);

  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid OPENCLAW_GATEWAY_PORT value: ${value}`);
  }

  return port;
}

/**
 * Builds a normalized gateway URL from protocol, host and port.
 *
 * @param protocol The gateway protocol.
 * @param host The gateway host name or IP.
 * @param port The gateway port.
 * @returns A normalized WebSocket URL.
 */
export function buildGatewayUrl(
  protocol: "ws" | "wss",
  host: string,
  port: number
): string {
  return new URL(`${protocol}://${host}:${port}`).toString();
}

/**
 * Converts the gateway URL into an HTTP(S) base URL for REST proxies.
 *
 * @param url The configured gateway URL.
 * @returns A normalized HTTP or HTTPS base URL.
 * @throws {Error} Thrown when the protocol cannot be converted.
 */
export function resolveGatewayHttpUrl(url: string): string {
  const parsed = new URL(url);

  if (parsed.protocol === "ws:") {
    parsed.protocol = "http:";
  } else if (parsed.protocol === "wss:") {
    parsed.protocol = "https:";
  } else if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `OPENCLAW_GATEWAY_URL must use ws, wss, http or https protocol: ${url}`
    );
  }

  return parsed.toString();
}

/**
 * Resolves the OpenClaw gateway timeout in milliseconds.
 *
 * @param value The raw environment variable value.
 * @returns A validated timeout value.
 * @throws {Error} Thrown when the timeout is not a positive integer.
 */
export function resolveTimeoutMs(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 5_000;
  }

  const timeoutMs = Number.parseInt(value, 10);

  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid OPENCLAW_GATEWAY_TIMEOUT_MS value: ${value}`);
  }

  return timeoutMs;
}

/**
 * Resolves a positive integer from an optional environment variable.
 *
 * @param value The raw environment variable value.
 * @param defaultValue Value returned when the raw value is empty.
 * @param variableName Environment variable name used in error messages.
 * @returns A positive integer.
 * @throws {Error} Thrown when the value is not a positive integer.
 */
export function resolvePositiveInteger(
  value: string | undefined,
  defaultValue: number,
  variableName: string
): number {
  if (value === undefined || value.trim() === "") {
    return defaultValue;
  }

  const parsed = Number.parseInt(value, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid ${variableName} value: ${value}`);
  }

  return parsed;
}

/**
 * Resolves the BKN backend base URL.
 *
 * @param value The raw environment variable value.
 * @returns A normalized HTTP(S) URL string.
 * @throws {Error} Thrown when the URL is invalid or uses an unsupported protocol.
 */
export function resolveBknBackendUrl(value: string | undefined): string {
  const rawValue = readOptionalString(value) ?? "http://127.0.0.1:13014";
  const url = new URL(rawValue);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`KWEAVER_BASE_URL must use http or https protocol: ${rawValue}`);
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url.toString();
}

/**
 * Resolves the Hydra admin base URL.
 *
 * @param value The raw environment variable value.
 * @returns A normalized HTTP(S) URL string.
 * @throws {Error} Thrown when the URL is invalid or uses an unsupported protocol.
 */
export function resolveHydraAdminUrl(value: string | undefined): string {
  const rawValue = readOptionalString(value) ?? "http://127.0.0.1:4445";
  const url = new URL(rawValue);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`KWEAVER_HYDRA_ADMIN_URL must use http or https protocol: ${rawValue}`);
  }

  url.pathname = "/";
  url.search = "";
  url.hash = "";

  return url.toString();
}

/**
 * Returns whether the current runtime should be treated as development mode.
 *
 * @param value The raw NODE_ENV value.
 * @returns `true` when development mode should be enabled.
 */
export function isDevelopmentMode(value: string | undefined): boolean {
  return readOptionalString(value) === "development";
}

/**
 * Trims an optional environment string.
 *
 * @param value The raw environment variable value.
 * @returns The trimmed string, or `undefined` when empty.
 */
export function readOptionalString(value: string | undefined): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

/**
 * Resolves the OpenClaw workspace root directory passed to OpenClaw RPC calls.
 *
 * @param value The raw OPENCLAW_HOST_PATH environment variable value.
 * @returns The configured workspace root directory from OpenClaw's host view.
 * @throws {Error} Thrown when OPENCLAW_HOST_PATH is empty.
 */
export function resolveLocalWorkspaceDir(
  value: string | undefined = process.env.OPENCLAW_HOST_PATH
): string {
  const openClawHostPath = readOptionalString(value);

  if (openClawHostPath === undefined) {
    throw new Error("OPENCLAW_HOST_PATH is required");
  }

  return join(openClawHostPath, "workspace");
}

/**
 * Extracts a safe error message from an unknown thrown value.
 *
 * @param error The unknown thrown value.
 * @returns A human-readable error message.
 */
export function asMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
