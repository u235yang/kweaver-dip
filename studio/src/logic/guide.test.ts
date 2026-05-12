import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "../errors/http-error";
import type { StudioConfigAdapter } from "../adapters/studio-config-adapter";
import { setStudioRuntimeConfig } from "../utils/env";

/**
 * Mutable fake home for `node:os` `homedir` (see hoisted mock below).
 */
let fakeHomeForOsMock = process.env.HOME ?? "/tmp";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: (): string => fakeHomeForOsMock
  };
});

import {
  buildGuideEnvFileContent,
  buildOpenClawRootEnvEntries,
  buildGuideEnvEntries,
  collectMissingRequirements,
  DefaultGuideLogic,
  encodeEnvValue,
  extractOpenClawGatewayPort,
  mergeOpenClawRootEnv,
  normalizeInitializeGuideRequest,
  parseOpenClawAddress,
  parseDotEnv,
  openClawRootEnvEntriesNeedUpdate,
  readOpenClawDetectedConfig,
  readOpenClawDetectedConfigFromEnv,
  readOpenClawGatewayConfigFromConfig,
  readOpenClawGatewayTokenFromConfig,
  refreshOpenClawRuntimeEnv,
  resolveDefaultKweaverBaseUrl,
  resolveDefaultOpenClawGatewayAddress,
  resolveExternalOpenClawHost,
  resolveHostWorkspaceDir,
  resolveHostAddress,
  resolveInjectedPath,
  stripWrappingQuotes,
  upsertEnvEntries
} from "./guide";

/**
 * Creates a Studio config adapter test double.
 *
 * @returns A mocked Studio config adapter.
 */
function createConfigAdapterDouble(): StudioConfigAdapter {
  return {
    findStudioConfig: vi.fn().mockResolvedValue(undefined),
    upsertStudioConfig: vi.fn().mockResolvedValue(undefined)
  };
}

afterEach(() => {
  setStudioRuntimeConfig(undefined);
});

describe("readOpenClawDetectedConfigFromEnv", () => {
  it("reads the gateway connection info from injected env vars", async () => {
    await expect(
      readOpenClawDetectedConfigFromEnv({
        OPENCLAW_GATEWAY_PROTOCOL: "wss",
        OPENCLAW_GATEWAY_HOST: "gateway.example.com",
        OPENCLAW_GATEWAY_PORT: "18443",
        OPENCLAW_GATEWAY_TOKEN: " token-1 ",
        KWEAVER_BASE_URL: " https://kweaver.example.com "
      })
    ).resolves.toEqual({
      openclaw_address: "wss://gateway.example.com:18443",
      openclaw_token: "token-1",
      kweaver_base_url: "https://kweaver.example.com"
    });
  });

  it("reads fallback gateway port and token from openclaw.json", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "dip-openclaw-config-"));
    const configPath = join(rootDir, "openclaw.json");
    await writeFile(
      configPath,
      JSON.stringify({ gateway: { port: 18789, auth: { token: "config-token" } } }),
      "utf8"
    );

    await expect(
      readOpenClawDetectedConfig({
        envSource: {
          USE_EXTERNAL_OPENCLAW: "true"
        },
        openClawConfigPath: configPath,
        requestHost: "studio.example.com:3000"
      })
    ).resolves.toEqual({
      openclaw_address: "ws://studio.example.com:18789",
      openclaw_token: "config-token",
      kweaver_base_url: "http://studio.example.com:3000"
    });

    await expect(readOpenClawGatewayConfigFromConfig(configPath)).resolves.toEqual({
      port: 18789,
      token: "config-token"
    });

    await rm(rootDir, { recursive: true, force: true });
  });

  it("reads string gateway port from openclaw.json", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "dip-openclaw-config-"));
    const configPath = join(rootDir, "openclaw.json");
    await writeFile(
      configPath,
      JSON.stringify({ gateway: { port: "18790", auth: { token: "config-token" } } }),
      "utf8"
    );

    await expect(readOpenClawGatewayConfigFromConfig(configPath)).resolves.toEqual({
      port: 18790,
      token: "config-token"
    });
    expect(extractOpenClawGatewayPort({ gateway: { port: "bad" } })).toBeUndefined();

    await rm(rootDir, { recursive: true, force: true });
  });

  it("rejects missing gateway port from openclaw.json", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "dip-openclaw-config-"));
    const configPath = join(rootDir, "openclaw.json");
    await writeFile(
      configPath,
      JSON.stringify({ gateway: { auth: { token: "config-token" } } }),
      "utf8"
    );

    await expect(readOpenClawGatewayConfigFromConfig(configPath)).rejects.toThrowError(
      new HttpError(
        500,
        "OpenClaw gateway port is missing from openclaw.json",
        "OPENCLAW_GATEWAY_PORT_NOT_FOUND"
      )
    );

    await rm(rootDir, { recursive: true, force: true });
  });

  it("does not read gateway token from gateway.token", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "dip-openclaw-config-"));
    const configPath = join(rootDir, "openclaw.json");
    await writeFile(
      configPath,
      JSON.stringify({ gateway: { token: "legacy-token" } }),
      "utf8"
    );

    await expect(readOpenClawGatewayTokenFromConfig(configPath)).rejects.toThrowError(
      new HttpError(
        500,
        "OpenClaw gateway token is missing from openclaw.json",
        "OPENCLAW_GATEWAY_TOKEN_NOT_FOUND"
      )
    );

    await rm(rootDir, { recursive: true, force: true });
  });

  it("rejects missing gateway token from openclaw.json", async () => {
    await expect(
      readOpenClawDetectedConfig({
        envSource: {},
        openClawConfigPath: "/missing/openclaw.json"
      })
    ).rejects.toThrowError(
      new HttpError(
        500,
        "OpenClaw gateway config is missing from openclaw.json",
        "OPENCLAW_CONFIG_NOT_FOUND"
      )
    );
  });

  it("resolves default gateway address by OpenClaw mode", () => {
    expect(resolveDefaultOpenClawGatewayAddress({}, "studio.example.com:3000")).toBe(
      "ws://127.0.0.1:19001"
    );
    expect(
      resolveDefaultOpenClawGatewayAddress(
        { USE_EXTERNAL_OPENCLAW: "true" },
        "studio.example.com:3000"
      )
    ).toBe("ws://studio.example.com:19001");
    expect(resolveExternalOpenClawHost("[::1]:3000")).toBe("::1");
    expect(
      resolveDefaultOpenClawGatewayAddress(
        { USE_EXTERNAL_OPENCLAW: "true" },
        "[::1]:3000",
        18789
      )
    ).toBe("ws://[::1]:18789");
  });

  it("resolves host address from request-derived values", () => {
    expect(resolveHostAddress("https://studio.example.com:3000/path")).toBe(
      "studio.example.com:3000"
    );
    expect(resolveHostAddress("studio.example.com:3000, proxy.example.com")).toBe(
      "studio.example.com:3000"
    );
    expect(resolveHostAddress("[::1]:3000")).toBe("[::1]:3000");
    expect(resolveHostAddress(undefined)).toBe("127.0.0.1");
  });

  it("resolves default KWeaver base URL from host address", () => {
    expect(resolveDefaultKweaverBaseUrl({}, "studio.example.com:3000")).toBe(
      "http://studio.example.com:3000"
    );
    expect(
      resolveDefaultKweaverBaseUrl(
        { USE_EXTERNAL_OPENCLAW: "true" },
        "studio.example.com:3000"
      )
    ).toBe("http://studio.example.com:3000");
    expect(
      resolveDefaultKweaverBaseUrl(
        { USE_EXTERNAL_OPENCLAW: "true" },
        "https://studio.example.com/guide/openclaw-config"
      )
    ).toBe("https://studio.example.com");
    expect(
      resolveDefaultKweaverBaseUrl({ USE_EXTERNAL_OPENCLAW: "true" }, "[::1]:3000")
    ).toBe("http://[::1]:3000");
  });
});

describe("resolveInjectedPath", () => {
  it("converts relative and home-relative paths to absolute paths", () => {
    expect(resolveInjectedPath("./openclaw.json")).toMatch(/openclaw\.json$/);
    expect(resolveInjectedPath("~/openclaw.json")).toBe(
      join(process.env.HOME ?? "", "openclaw.json")
    );
  });
});

describe("dotenv helpers", () => {
  it("parses dotenv content and strips quotes", () => {
    expect(
      parseDotEnv([
        "A=1",
        "B=\"two words\"",
        "C=value # inline comment"
      ].join("\n"))
    ).toEqual({
      A: "1",
      B: "two words",
      C: "value"
    });
    expect(stripWrappingQuotes("\"x\"")).toBe("x");
    expect(stripWrappingQuotes("y")).toBe("y");
  });

  it("updates env entries without discarding other lines", () => {
    expect(
      upsertEnvEntries(
        ["A=1", "# comment", "B=2"].join("\n"),
        [
          ["B", "3"],
          ["C", "4 5"]
        ]
      )
    ).toBe(["A=1", "# comment", "B=3", "C=\"4 5\"", ""].join("\n"));
    expect(encodeEnvValue("plain")).toBe("plain");
  });
});

describe("normalizeInitializeGuideRequest", () => {
  it("parses the full openclaw address", () => {
    expect(parseOpenClawAddress("ws://127.0.0.1:19001")).toEqual({
      protocol: "ws",
      host: "127.0.0.1",
      port: 19001
    });
    expect(() => parseOpenClawAddress("http://127.0.0.1:19001")).toThrow(
      "openclaw_address must use ws or wss protocol"
    );
  });

  it("derives default state and workspace directories", () => {
    const previousOpenClawHostPath = process.env.OPENCLAW_HOST_PATH;

    try {
      process.env.OPENCLAW_HOST_PATH = "/data/.openclaw";

      expect(
        normalizeInitializeGuideRequest({
          openclaw_address: "ws://127.0.0.1:19001",
          openclaw_token: "token-1",
          kweaver_base_url: "https://kweaver.example.com"
        })
      ).toEqual({
        openclaw_address: "ws://127.0.0.1:19001",
        openclaw_token: "token-1",
        kweaver_base_url: "https://kweaver.example.com",
        configPath: join(process.env.HOME ?? "", ".openclaw", "openclaw.json"),
        protocol: "ws",
        host: "127.0.0.1",
        port: 19001,
        token: "token-1",
        stateDir: join(process.env.HOME ?? "", ".openclaw"),
        workspaceDir: join("/data/.openclaw", "workspace")
      });
    } finally {
      if (previousOpenClawHostPath === undefined) {
        delete process.env.OPENCLAW_HOST_PATH;
      } else {
        process.env.OPENCLAW_HOST_PATH = previousOpenClawHostPath;
      }
    }
  });

  it("builds the expected env entries", () => {
    expect(
      buildGuideEnvEntries({
        openclaw_address: "ws://127.0.0.1:19001",
        openclaw_token: "token-1",
        kweaver_base_url: "https://kweaver.example.com",
        configPath: "/tmp/openclaw/openclaw.json",
        protocol: "ws",
        host: "127.0.0.1",
        port: 19001,
        token: "token-1",
        stateDir: "/tmp/openclaw",
        workspaceDir: "/tmp/openclaw/workspace"
      })
    ).toEqual([
      ["PORT", "3000"],
      ["OPENCLAW_GATEWAY_TIMEOUT_MS", "5000"],
      ["OAUTH_MOCK_USER_ID", ""],
      ["KWEAVER_HYDRA_ADMIN_URL", ""]
    ]);
  });

  it("builds the expected OpenClaw root env entries", () => {
    expect(
      buildOpenClawRootEnvEntries({
        openclaw_address: "ws://127.0.0.1:19001",
        openclaw_token: "token-1",
        kweaver_base_url: "https://kweaver.example.com",
        configPath: "/tmp/openclaw/openclaw.json",
        protocol: "ws",
        host: "127.0.0.1",
        port: 19001,
        token: "token-1",
        stateDir: "/tmp/openclaw",
        workspaceDir: "/tmp/openclaw/workspace"
      })
    ).toEqual([]);
  });

  it("builds the full guide env file content without comments or trailing spaces", () => {
    const content = buildGuideEnvFileContent({
      openclaw_address: "ws://127.0.0.1:19001",
      openclaw_token: "token-1",
      kweaver_base_url: "https://kweaver.example.com",
      configPath: "/tmp/openclaw/openclaw.json",
      protocol: "ws",
      host: "127.0.0.1",
      port: 19001,
      token: "token-1",
      stateDir: "/tmp/openclaw",
      workspaceDir: "/tmp/openclaw/workspace"
    });

    expect(content).toContain("OAUTH_MOCK_USER_ID=");
    expect(content).not.toContain("OPENCLAW_ROOT_DIR=");
    expect(content).not.toContain("OPENCLAW_CONFIG_PATH=");
    expect(content).not.toContain("#");
    expect(content.split("\n").every((line) => line === line.replace(/[ \t]+$/, ""))).toBe(true);
  });
});

describe("collectMissingRequirements", () => {
  let studioRootDir: string;

  beforeEach(async () => {
    studioRootDir = await mkdtemp(join(tmpdir(), "dip-studio-guide-status-"));
  });

  it("reports all requirements when env file is missing", async () => {
    expect(await collectMissingRequirements(studioRootDir)).toEqual([
      "envFile",
      "privateKey",
      "publicKey"
    ]);
  });

  it("reports ready when env and assets are present", async () => {
    await mkdir(join(studioRootDir, "assets"), { recursive: true });
    await writeFile(
      join(studioRootDir, ".env"),
      [
        "OPENCLAW_GATEWAY_PROTOCOL=ws",
        "OPENCLAW_GATEWAY_HOST=127.0.0.1",
        "OPENCLAW_GATEWAY_PORT=19001",
        "OPENCLAW_GATEWAY_TOKEN=token-1"
      ].join("\n"),
      "utf8"
    );
    await writeFile(join(studioRootDir, "assets", "private.pem"), "private", "utf8");
    await writeFile(join(studioRootDir, "assets", "public.pem"), "public", "utf8");

    expect(await collectMissingRequirements(studioRootDir)).toEqual([]);
  });
});

describe("DefaultGuideLogic", () => {
  it("returns pending status when requirements are missing", async () => {
    const studioRootDir = await mkdtemp(join(tmpdir(), "dip-studio-guide-logic-"));
    const logic = new DefaultGuideLogic({
      studioRootDir,
      commandRunner: {
        execFile: vi.fn()
      },
      studioConfigAdapter: createConfigAdapterDouble()
    });

    await expect(logic.getStatus()).resolves.toEqual({
      state: "pending",
      ready: false,
      missing: [
        "envFile",
        "privateKey",
        "publicKey"
      ]
    });

    await rm(studioRootDir, { recursive: true, force: true });
  });

  it("reads local OpenClaw config from injected env vars", async () => {
    const execFile = vi.fn();
    const prevProtocol = process.env.OPENCLAW_GATEWAY_PROTOCOL;
    const prevHost = process.env.OPENCLAW_GATEWAY_HOST;
    const prevPort = process.env.OPENCLAW_GATEWAY_PORT;
    const prevToken = process.env.OPENCLAW_GATEWAY_TOKEN;
    const prevOpenClawHostPath = process.env.OPENCLAW_HOST_PATH;
    process.env.OPENCLAW_GATEWAY_PROTOCOL = "ws";
    process.env.OPENCLAW_GATEWAY_HOST = "127.0.0.1";
    process.env.OPENCLAW_GATEWAY_PORT = "19001";
    process.env.OPENCLAW_GATEWAY_TOKEN = "token-1";
    process.env.OPENCLAW_HOST_PATH = join(fakeHomeForOsMock, ".openclaw");
    const logic = new DefaultGuideLogic({
      studioRootDir: process.cwd(),
      commandRunner: {
        execFile
      },
      studioConfigAdapter: createConfigAdapterDouble()
    });

    try {
      await expect(logic.getOpenClawConfig()).resolves.toEqual({
        openclaw_address: "ws://127.0.0.1:19001",
        openclaw_token: "token-1",
        kweaver_base_url: "http://127.0.0.1"
      });
      expect(execFile).not.toHaveBeenCalled();
    } finally {
      process.env.OPENCLAW_GATEWAY_PROTOCOL = prevProtocol;
      process.env.OPENCLAW_GATEWAY_HOST = prevHost;
      process.env.OPENCLAW_GATEWAY_PORT = prevPort;
      process.env.OPENCLAW_GATEWAY_TOKEN = prevToken;
      if (prevOpenClawHostPath === undefined) {
        delete process.env.OPENCLAW_HOST_PATH;
      } else {
        process.env.OPENCLAW_HOST_PATH = prevOpenClawHostPath;
      }
    }
  });

  it("reads OpenClaw and KWeaver config from Studio config storage", async () => {
    const studioConfigAdapter = createConfigAdapterDouble();
    vi.mocked(studioConfigAdapter.findStudioConfig).mockResolvedValue({
      kweaver_base_url: "https://kweaver.example.com",
      openclaw_address: "ws://127.0.0.1:19001",
      openclaw_token: "token-1"
    });
    const logic = new DefaultGuideLogic({
      studioRootDir: process.cwd(),
      commandRunner: {
        execFile: vi.fn()
      },
      studioConfigAdapter
    });

    await expect(logic.getOpenClawConfig()).resolves.toEqual({
      kweaver_base_url: "https://kweaver.example.com",
      openclaw_address: "ws://127.0.0.1:19001",
      openclaw_token: "token-1"
    });
  });

  it("initializes env, assets, and init script", async () => {
    const studioRootDir = await mkdtemp(join(tmpdir(), "dip-studio-guide-init-"));
    fakeHomeForOsMock = studioRootDir;
    const execFile = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: ""
    });
    const gatewayConnector = {
      reconfigureConnection: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined)
    };
    const openClawConfigRefresher = {
      getConfig: vi.fn().mockResolvedValue({
        raw: "{}",
        hash: "hash-1"
      }),
      patchConfig: vi.fn().mockResolvedValue({
        ok: true
      })
    };
    const studioConfigAdapter = createConfigAdapterDouble();
    const prevKweaverBaseUrl = process.env.KWEAVER_BASE_URL;
    const prevOpenClawHostPath = process.env.OPENCLAW_HOST_PATH;
    process.env.OPENCLAW_HOST_PATH = join(studioRootDir, ".openclaw");
    const logic = new DefaultGuideLogic({
      studioRootDir,
      commandRunner: {
        execFile
      },
      gatewayConnector,
      openClawConfigRefresher,
      studioConfigAdapter
    });

    await expect(
      logic.initialize({
        openclaw_address: "ws://127.0.0.1:19001",
        openclaw_token: "token-1",
        kweaver_base_url: "https://kweaver.example.com"
      })
    ).resolves.toBeUndefined();

    try {
      const envContent = await readFile(join(studioRootDir, ".env"), "utf8");
      expect(envContent).not.toContain("OPENCLAW_GATEWAY_TOKEN=token-1");
      expect(envContent).not.toContain("KWEAVER_BASE_URL=https://kweaver.example.com");
      expect(envContent).not.toContain("OPENCLAW_ROOT_DIR=");
      expect(envContent).not.toContain("OPENCLAW_CONFIG_PATH=");
      expect(envContent).not.toContain("OPENCLAW_WORKSPACE_DIR=");
      expect(envContent).not.toContain("#");
      expect(envContent.split("\n").every((line) => line === line.replace(/[ \t]+$/, ""))).toBe(true);
      expect(studioConfigAdapter.upsertStudioConfig).toHaveBeenCalledWith({
        kweaver_base_url: "https://kweaver.example.com",
        openclaw_address: "ws://127.0.0.1:19001",
        openclaw_token: "token-1"
      });
      expect(execFile).toHaveBeenNthCalledWith(
        1,
        "npm",
        ["run", "init:agents"],
        { cwd: studioRootDir }
      );
      expect(gatewayConnector.reconfigureConnection).toHaveBeenCalledWith(
        "ws://127.0.0.1:19001",
        "token-1"
      );
      expect(gatewayConnector.connect).toHaveBeenCalledOnce();
      expect(openClawConfigRefresher.getConfig).not.toHaveBeenCalled();
      expect(openClawConfigRefresher.patchConfig).not.toHaveBeenCalled();
    } finally {
      if (prevKweaverBaseUrl === undefined) {
        delete process.env.KWEAVER_BASE_URL;
      } else {
        process.env.KWEAVER_BASE_URL = prevKweaverBaseUrl;
      }
      if (prevOpenClawHostPath === undefined) {
        delete process.env.OPENCLAW_HOST_PATH;
      } else {
        process.env.OPENCLAW_HOST_PATH = prevOpenClawHostPath;
      }
      fakeHomeForOsMock = process.env.HOME ?? "/tmp";
      await rm(studioRootDir, { recursive: true, force: true });
    }
  });

  it("initializes with host KWeaver URL when using host OpenClaw", async () => {
    const studioRootDir = await mkdtemp(join(tmpdir(), "dip-studio-guide-init-host-"));
    fakeHomeForOsMock = studioRootDir;
    const execFile = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: ""
    });
    const gatewayConnector = {
      reconfigureConnection: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined)
    };
    const studioConfigAdapter = createConfigAdapterDouble();
    const prevUseExternalOpenClaw = process.env.USE_EXTERNAL_OPENCLAW;
    const prevOpenClawHostPath = process.env.OPENCLAW_HOST_PATH;
    process.env.USE_EXTERNAL_OPENCLAW = "true";
    process.env.OPENCLAW_HOST_PATH = join(studioRootDir, ".openclaw");
    const logic = new DefaultGuideLogic({
      studioRootDir,
      commandRunner: {
        execFile
      },
      gatewayConnector,
      studioConfigAdapter
    });

    try {
      await expect(
        logic.initialize({
          openclaw_address: "ws://studio.example.com:19001",
          openclaw_token: "token-1"
        })
      ).resolves.toBeUndefined();

      expect(studioConfigAdapter.upsertStudioConfig).toHaveBeenCalledWith({
        kweaver_base_url: "http://studio.example.com",
        openclaw_address: "ws://studio.example.com:19001",
        openclaw_token: "token-1"
      });
    } finally {
      if (prevUseExternalOpenClaw === undefined) {
        delete process.env.USE_EXTERNAL_OPENCLAW;
      } else {
        process.env.USE_EXTERNAL_OPENCLAW = prevUseExternalOpenClaw;
      }
      if (prevOpenClawHostPath === undefined) {
        delete process.env.OPENCLAW_HOST_PATH;
      } else {
        process.env.OPENCLAW_HOST_PATH = prevOpenClawHostPath;
      }
      fakeHomeForOsMock = process.env.HOME ?? "/tmp";
      await rm(studioRootDir, { recursive: true, force: true });
    }
  });

  it("skips OpenClaw refresh when root env values are unchanged", async () => {
    const studioRootDir = await mkdtemp(join(tmpdir(), "dip-studio-guide-init-same-"));
    fakeHomeForOsMock = studioRootDir;
    await mkdir(join(fakeHomeForOsMock, ".openclaw"), { recursive: true });
    await writeFile(
      join(fakeHomeForOsMock, ".openclaw", ".env"),
      [
        "KWEAVER_BASE_URL=https://kweaver.example.com",
        "KWEAVER_BUSINESS_DOMAIN=bd_public",
        "KWEAVER_TLS_INSECURE=1",
        ""
      ].join("\n"),
      "utf8"
    );
    const execFile = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: ""
    });
    const gatewayConnector = {
      reconfigureConnection: vi.fn(),
      connect: vi.fn().mockResolvedValue(undefined)
    };
    const openClawConfigRefresher = {
      getConfig: vi.fn().mockResolvedValue({
        raw: "{}",
        hash: "hash-1"
      }),
      patchConfig: vi.fn().mockResolvedValue({
        ok: true
      })
    };
    const studioConfigAdapter = createConfigAdapterDouble();
    const prevKweaverBaseUrl = process.env.KWEAVER_BASE_URL;
    const prevOpenClawHostPath = process.env.OPENCLAW_HOST_PATH;
    process.env.OPENCLAW_HOST_PATH = join(studioRootDir, ".openclaw");
    const logic = new DefaultGuideLogic({
      studioRootDir,
      commandRunner: {
        execFile
      },
      gatewayConnector,
      openClawConfigRefresher,
      studioConfigAdapter
    });

    try {
      await expect(
        logic.initialize({
          openclaw_address: "ws://127.0.0.1:19001",
          openclaw_token: "token-1",
          kweaver_base_url: "https://kweaver.example.com"
        })
      ).resolves.toBeUndefined();

      expect(openClawConfigRefresher.getConfig).not.toHaveBeenCalled();
      expect(openClawConfigRefresher.patchConfig).not.toHaveBeenCalled();
      expect(studioConfigAdapter.upsertStudioConfig).toHaveBeenCalledOnce();
    } finally {
      if (prevKweaverBaseUrl === undefined) {
        delete process.env.KWEAVER_BASE_URL;
      } else {
        process.env.KWEAVER_BASE_URL = prevKweaverBaseUrl;
      }
      if (prevOpenClawHostPath === undefined) {
        delete process.env.OPENCLAW_HOST_PATH;
      } else {
        process.env.OPENCLAW_HOST_PATH = prevOpenClawHostPath;
      }
      fakeHomeForOsMock = process.env.HOME ?? "/tmp";
      await rm(studioRootDir, { recursive: true, force: true });
    }
  });
});

describe("OpenClaw root env helpers", () => {
  it("refreshes OpenClaw runtime env without writing env values to config", async () => {
    const refresher = {
      getConfig: vi.fn().mockResolvedValue({
        raw: "{}",
        hash: "hash-1"
      }),
      patchConfig: vi.fn().mockResolvedValue({
        ok: true
      })
    };

    await refreshOpenClawRuntimeEnv(refresher);

    expect(refresher.patchConfig).toHaveBeenCalledWith({
      raw: "{}",
      baseHash: "hash-1"
    });
  });

  it("resolves local OpenClaw paths from the Studio process home", () => {
    expect(
      resolveHostWorkspaceDir(
        {
          OPENCLAW_ROOT_DIR: "~/.openclaw-dev",
          OPENCLAW_HOST_PATH: "/data/.openclaw"
        },
        "/tmp/studio"
      )
    ).toEqual({
      configPath: join(fakeHomeForOsMock, ".openclaw", "openclaw.json"),
      stateDir: join(fakeHomeForOsMock, ".openclaw"),
      workspaceDir: join(fakeHomeForOsMock, ".openclaw", "workspace")
    });
  });

  it("does not write OpenClaw root env values", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "dip-openclaw-root-env-"));
    const envFilePath = join(rootDir, ".env");

    await expect(
      mergeOpenClawRootEnv(envFilePath, [
        ["KWEAVER_BASE_URL", "https://kweaver.example.com"]
      ])
    ).rejects.toThrow(
      "Writing Studio connection config to OpenClaw .env is disabled"
    );
  });

  it("detects whether managed OpenClaw root env entries changed", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "dip-openclaw-root-env-check-"));
    const envFilePath = join(rootDir, ".env");
    const entries = [
      ["KWEAVER_BASE_URL", "https://kweaver.example.com"]
    ] as const;

    await expect(openClawRootEnvEntriesNeedUpdate(envFilePath, entries)).resolves.toBe(true);

    await writeFile(
      envFilePath,
      ["KWEAVER_BASE_URL=https://kweaver.example.com", "KWEAVER_TOKEN=kw-token", ""].join("\n"),
      "utf8"
    );

    await expect(openClawRootEnvEntriesNeedUpdate(envFilePath, entries)).resolves.toBe(false);
    await expect(
      openClawRootEnvEntriesNeedUpdate(envFilePath, [
        ["KWEAVER_BASE_URL", "https://new.example.com"]
      ])
    ).resolves.toBe(true);
  });
});
