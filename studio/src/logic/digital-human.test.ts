import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HttpError } from "../errors/http-error";
import type { DigitalEmployeeTokenAdapter } from "../adapters/digital-employee-token-adapter";
import type { OpenClawCronAdapter } from "../adapters/openclaw-cron-adapter";

import type { AgentSkillsLogic } from "./agent-skills";

/**
 * Mutable fake home for `node:os` `homedir` (see hoisted mock below).
 */
let fakeHomeForOsMock = "/tmp";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: (): string => fakeHomeForOsMock
  };
});

import {
  DefaultDigitalHumanLogic,
  normalizeOpenClawAccountIdFromAppId,
  resolveDefaultWorkspace
} from "./digital-human";

function stubDigitalEmployeeTokenAdapter(
  overrides?: Partial<DigitalEmployeeTokenAdapter>
): DigitalEmployeeTokenAdapter {
  return {
    findKweaverToken: vi.fn(),
    upsertKweaverToken: vi.fn().mockResolvedValue(undefined),
    deleteKweaverToken: vi.fn().mockResolvedValue(undefined),
    markDigitalEmployeeDeleted: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

function stubAgentSkills(overrides?: Partial<AgentSkillsLogic>): AgentSkillsLogic {
  return {
    listEnabledSkills: vi.fn(),
    listDigitalHumanSkills: vi.fn(),
    listAvailableSkills: vi.fn(),
    getAgentSkills: vi.fn().mockResolvedValue({ agentId: "", skills: [] }),
    updateAgentSkills: vi.fn().mockResolvedValue({
      success: true,
      agentId: "",
      skills: []
    }),
    installSkill: vi.fn().mockResolvedValue({
      name: "",
      skillPath: ""
    }),
    uninstallSkill: vi.fn().mockResolvedValue({ name: "" }),
    ...overrides
  } as AgentSkillsLogic;
}

function stubCronAdapter(
  overrides?: Partial<OpenClawCronAdapter>
): OpenClawCronAdapter {
  return {
    listCronJobs: vi.fn().mockResolvedValue({
      jobs: [],
      total: 0,
      offset: 0,
      limit: 200,
      hasMore: false,
      nextOffset: null
    }),
    updateCronJob: vi.fn(),
    removeCronJob: vi.fn().mockResolvedValue({ removed: true }),
    listCronRuns: vi.fn(),
    ...overrides
  } as OpenClawCronAdapter;
}

describe("DefaultDigitalHumanLogic", () => {
  it("fetches agents and enriches list with full detail fields", async () => {
    const openClawAgentsAdapter = {
      listAgents: vi.fn().mockResolvedValue({
        defaultId: "main",
        mainKey: "sender",
        scope: "per-sender",
        agents: [
          {
            id: "agent-1",
            name: "Listed Agent",
            identity: {
              avatarUrl: "https://example.com/main.png"
            }
          }
        ]
      }),
      getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
        file: {
          content: name === "IDENTITY.md"
            ? "# IDENTITY.md\n\n- Name: From File\n- Creature: Engineer\n"
            : "Soul content\n"
        }
      }))
    };
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: openClawAgentsAdapter as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    const result = await logic.listDigitalHumans();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "agent-1",
      name: "From File",
      creature: "Engineer",
      soul: "Soul content\n"
    });
    expect(openClawAgentsAdapter.listAgents).toHaveBeenCalledOnce();
  });

  it("filters hidden built-in assistants from the list", async () => {
    const openClawAgentsAdapter = {
      listAgents: vi.fn().mockResolvedValue({
        defaultId: "main",
        mainKey: "sender",
        scope: "per-sender",
        agents: [
          {
            id: "main",
            name: "Main Agent"
          },
          {
            id: "__internal_skill_agent__",
            name: "Skill Agent"
          },
          {
            id: "a1",
            name: "Visible Agent"
          }
        ]
      }),
      getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
        file: {
          content: name === "IDENTITY.md"
            ? "- Name: Visible Agent\n- Creature: Analyst\n"
            : ""
        }
      }))
    };
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: openClawAgentsAdapter as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    const result = await logic.listDigitalHumans();
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      id: "a1",
      name: "Visible Agent",
      creature: "Analyst"
    });
  });

  it("list falls back when getDigitalHuman fails", async () => {
    const openClawAgentsAdapter = {
      listAgents: vi.fn().mockResolvedValue({
        defaultId: "main",
        mainKey: "sender",
        scope: "per-sender",
        agents: [
          {
            id: "a1",
            name: "Listed Name"
          }
        ]
      }),
      getAgentFile: vi.fn().mockRejectedValue(new Error("network"))
    };
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: openClawAgentsAdapter as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    await expect(logic.listDigitalHumans()).resolves.toEqual([
      {
        id: "a1",
        name: "Listed Name",
        creature: undefined,
        soul: "",
        bkn: undefined,
        skills: undefined
      }
    ]);
  });

});

describe("resolveDefaultWorkspace", () => {
  it("places workspace under ~/.openclaw/workspace/<uuid>", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(resolveDefaultWorkspace(id)).toBe(
      join(fakeHomeForOsMock, ".openclaw", "workspace", id)
    );
  });
});


describe("DefaultDigitalHumanLogic lifecycle (filesystem + adapter)", () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "dip-dh-"));
    fakeHomeForOsMock = fakeHome;
  });

  afterEach(() => {
    fakeHomeForOsMock = "/tmp";
    try {
      rmSync(fakeHome, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("getDigitalHuman reads template fields and skills", async () => {
    const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(
      join(ws, "IDENTITY.md"),
      "- Name: Alice\n- Creature: QA\n",
      "utf8"
    );
    writeFileSync(join(ws, "SOUL.md"), "Soul text\n", "utf8");

    const adapter = {
      listAgents: vi.fn(),
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
      getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
        file: { content: readFileSync(join(ws, name), "utf8") }
      })),
      setAgentFile: vi.fn(),
      getConfig: vi.fn(),
      patchConfig: vi.fn()
    };

    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: adapter as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills({
        getAgentSkills: vi.fn().mockResolvedValue({ agentId: id, skills: ["s1"] })
      })
    });

    await expect(logic.getDigitalHuman(id)).resolves.toMatchObject({
      id,
      name: "Alice",
      creature: "QA",
      soul: "Soul text\n",
      skills: ["s1"]
    });
  });

  it("normalizeOpenClawAccountIdFromAppId lowercases valid Feishu-style app ids", () => {
    expect(normalizeOpenClawAccountIdFromAppId("CLI_a92b87f167b99cbb")).toBe(
      "cli_a92b87f167b99cbb"
    );
    expect(normalizeOpenClawAccountIdFromAppId("")).toBe("default");
  });

  it("getDigitalHuman includes channel when OpenClaw config binds feishu via accounts", async () => {
    const id = "b1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(
      join(ws, "IDENTITY.md"),
      "- Name: Alice\n- Creature: QA\n",
      "utf8"
    );
    writeFileSync(join(ws, "SOUL.md"), "Soul text\n", "utf8");

    const rootDir = join(fakeHome, ".openclaw");
    mkdirSync(rootDir, { recursive: true });
    const configPath = join(rootDir, "openclaw.json");
    const accountId = normalizeOpenClawAccountIdFromAppId("cli_app-1");
    writeFileSync(
      configPath,
      JSON.stringify({
        bindings: [
          {
            agentId: id,
            match: { channel: "feishu", accountId }
          }
        ],
        channels: {
          feishu: {
            enabled: true,
            accounts: {
              [accountId]: {
                enabled: true,
                appId: "cli_app-1",
                appSecret: "secret-1"
              }
            }
          }
        }
      }),
      "utf8"
    );
    const prev = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = rootDir;

    try {
      const adapter = {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
          file: { content: readFileSync(join(ws, name), "utf8") }
        })),
        setAgentFile: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      };

      const logic = new DefaultDigitalHumanLogic({
        openClawAgentsAdapter: adapter as never,
        openClawCronAdapter: stubCronAdapter(),
        agentSkillsLogic: stubAgentSkills()
      });

      await expect(logic.getDigitalHuman(id)).resolves.toMatchObject({
        id,
        channel: { type: "feishu", appId: "cli_app-1", appSecret: "secret-1" }
      });
    } finally {
      if (prev === undefined) {
        delete process.env.OPENCLAW_ROOT_DIR;
      } else {
        process.env.OPENCLAW_ROOT_DIR = prev;
      }
    }
  });

  it("getDigitalHuman includes channel when OpenClaw config binds feishu", async () => {
    const id = "b1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(
      join(ws, "IDENTITY.md"),
      "- Name: Alice\n- Creature: QA\n",
      "utf8"
    );
    writeFileSync(join(ws, "SOUL.md"), "Soul text\n", "utf8");

    const rootDir = join(fakeHome, ".openclaw");
    mkdirSync(rootDir, { recursive: true });
    const configPath = join(rootDir, "openclaw.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        bindings: [{ agentId: id, match: { channel: "feishu" } }],
        channels: {
          feishu: {
            enabled: true,
            appId: "app-1",
            appSecret: "secret-1"
          }
        }
      }),
      "utf8"
    );
    const prev = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = rootDir;

    try {
      const adapter = {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
          file: { content: readFileSync(join(ws, name), "utf8") }
        })),
        setAgentFile: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      };

      const logic = new DefaultDigitalHumanLogic({
        openClawAgentsAdapter: adapter as never,
        openClawCronAdapter: stubCronAdapter(),
        agentSkillsLogic: stubAgentSkills()
      });

      await expect(logic.getDigitalHuman(id)).resolves.toMatchObject({
        id,
        channel: { type: "feishu", appId: "app-1", appSecret: "secret-1" }
      });
    } finally {
      if (prev === undefined) {
        delete process.env.OPENCLAW_ROOT_DIR;
      } else {
        process.env.OPENCLAW_ROOT_DIR = prev;
      }
    }
  });

  it("getDigitalHuman omits channel when config JSON is invalid", async () => {
    const id = "c1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "IDENTITY.md"), "- Name: A\n", "utf8");
    writeFileSync(join(ws, "SOUL.md"), "x\n", "utf8");

    const rootDir = join(fakeHome, ".openclaw");
    mkdirSync(rootDir, { recursive: true });
    const configPath = join(rootDir, "openclaw.json");
    writeFileSync(configPath, "{ not json", "utf8");
    const prev = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = rootDir;

    try {
      const adapter = {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
          file: { content: readFileSync(join(ws, name), "utf8") }
        })),
        setAgentFile: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      };
      const logic = new DefaultDigitalHumanLogic({
        openClawAgentsAdapter: adapter as never,
        openClawCronAdapter: stubCronAdapter(),
        agentSkillsLogic: stubAgentSkills()
      });
      const detail = await logic.getDigitalHuman(id);
      expect(detail.channel).toBeUndefined();
    } finally {
      if (prev === undefined) {
        delete process.env.OPENCLAW_ROOT_DIR;
      } else {
        process.env.OPENCLAW_ROOT_DIR = prev;
      }
    }
  });

  it("getDigitalHuman omits channel when binding channel key is unsupported", async () => {
    const id = "a0b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "IDENTITY.md"), "- Name: A\n", "utf8");
    writeFileSync(join(ws, "SOUL.md"), "x\n", "utf8");

    const rootDir = join(fakeHome, ".openclaw");
    mkdirSync(rootDir, { recursive: true });
    const configPath = join(rootDir, "openclaw.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        bindings: [{ agentId: id, match: { channel: "slack" } }],
        channels: { slack: { appId: "a", appSecret: "b" } }
      }),
      "utf8"
    );
    const prev = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = rootDir;

    try {
      const adapter = {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
          file: { content: readFileSync(join(ws, name), "utf8") }
        })),
        setAgentFile: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      };
      const logic = new DefaultDigitalHumanLogic({
        openClawAgentsAdapter: adapter as never,
        openClawCronAdapter: stubCronAdapter(),
        agentSkillsLogic: stubAgentSkills()
      });
      const detail = await logic.getDigitalHuman(id);
      expect(detail.channel).toBeUndefined();
    } finally {
      if (prev === undefined) {
        delete process.env.OPENCLAW_ROOT_DIR;
      } else {
        process.env.OPENCLAW_ROOT_DIR = prev;
      }
    }
  });

  it("getDigitalHuman omits channel when binding is for another agent", async () => {
    const id = "d1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "IDENTITY.md"), "- Name: A\n", "utf8");
    writeFileSync(join(ws, "SOUL.md"), "x\n", "utf8");

    const rootDir = join(fakeHome, ".openclaw");
    mkdirSync(rootDir, { recursive: true });
    const configPath = join(rootDir, "openclaw.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        bindings: [{ agentId: "other-id", match: { channel: "feishu" } }],
        channels: { feishu: { appId: "a", appSecret: "b" } }
      }),
      "utf8"
    );
    const prev = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = rootDir;

    try {
      const adapter = {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
          file: { content: readFileSync(join(ws, name), "utf8") }
        })),
        setAgentFile: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      };
      const logic = new DefaultDigitalHumanLogic({
        openClawAgentsAdapter: adapter as never,
        openClawCronAdapter: stubCronAdapter(),
        agentSkillsLogic: stubAgentSkills()
      });
      const detail = await logic.getDigitalHuman(id);
      expect(detail.channel).toBeUndefined();
    } finally {
      if (prev === undefined) {
        delete process.env.OPENCLAW_ROOT_DIR;
      } else {
        process.env.OPENCLAW_ROOT_DIR = prev;
      }
    }
  });

  it("getDigitalHuman omits channel when feishu credentials are incomplete", async () => {
    const id = "e1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(join(ws, "IDENTITY.md"), "- Name: A\n", "utf8");
    writeFileSync(join(ws, "SOUL.md"), "x\n", "utf8");

    const rootDir = join(fakeHome, ".openclaw");
    mkdirSync(rootDir, { recursive: true });
    const configPath = join(rootDir, "openclaw.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        bindings: [{ agentId: id, match: { channel: "feishu" } }],
        channels: { feishu: { appId: "", appSecret: "only-secret" } }
      }),
      "utf8"
    );
    const prev = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = rootDir;

    try {
      const adapter = {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
          file: { content: readFileSync(join(ws, name), "utf8") }
        })),
        setAgentFile: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      };
      const logic = new DefaultDigitalHumanLogic({
        openClawAgentsAdapter: adapter as never,
        openClawCronAdapter: stubCronAdapter(),
        agentSkillsLogic: stubAgentSkills()
      });
      const detail = await logic.getDigitalHuman(id);
      expect(detail.channel).toBeUndefined();
    } finally {
      if (prev === undefined) {
        delete process.env.OPENCLAW_ROOT_DIR;
      } else {
        process.env.OPENCLAW_ROOT_DIR = prev;
      }
    }
  });

  it("getDigitalHuman maps unknown agent errors to 404", async () => {
    const adapter = {
      listAgents: vi.fn(),
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
      getAgentFile: vi.fn().mockRejectedValue(new Error("unknown agent id")),
      setAgentFile: vi.fn(),
      getConfig: vi.fn(),
      patchConfig: vi.fn()
    };
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: adapter as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    await expect(logic.getDigitalHuman("missing")).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("getDigitalHuman rethrows HttpError unchanged", async () => {
    const forbidden = new HttpError(403, "forbidden");
    const adapter = {
      listAgents: vi.fn(),
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
      getAgentFile: vi.fn().mockRejectedValue(forbidden),
      setAgentFile: vi.fn(),
      getConfig: vi.fn(),
      patchConfig: vi.fn()
    };
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: adapter as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    await expect(logic.getDigitalHuman("x")).rejects.toBe(forbidden);
  });

  it("deleteDigitalHuman deletes the agent and its plans", async () => {
    const deleteAgent = vi.fn().mockResolvedValue({ ok: true });
    const listCronJobs = vi.fn().mockResolvedValue({
      jobs: [
        {
          id: "plan-1",
          agentId: "agent-1",
          sessionKey: "agent:agent-1:cron:plan-1:run:run-1",
          name: "Plan 1",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: {},
          targetType: "session"
        },
        {
          id: "plan-2",
          agentId: "other-agent",
          sessionKey: "agent:other-agent:cron:plan-2:run:run-1",
          name: "Plan 2",
          enabled: true,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: {},
          targetType: "session"
        },
        {
          id: "plan-3",
          agentId: "agent-1",
          sessionKey: "agent:agent-1:cron:plan-3:run:run-1",
          name: "Plan 3",
          enabled: false,
          createdAtMs: 1,
          updatedAtMs: 1,
          schedule: {},
          targetType: "session"
        }
      ],
      total: 3,
      offset: 0,
      limit: 200,
      hasMore: false,
      nextOffset: null
    });
    const removeCronJob = vi.fn().mockResolvedValue({ removed: true });
    const tokenAdapter = stubDigitalEmployeeTokenAdapter();
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent,
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn(),
        listAgentFiles: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      } as never,
      openClawCronAdapter: stubCronAdapter({
        listCronJobs,
        removeCronJob
      }),
      agentSkillsLogic: stubAgentSkills(),
      digitalEmployeeTokenAdapter: tokenAdapter
    });

    await logic.deleteDigitalHuman("agent-1", false);

    expect(listCronJobs).toHaveBeenCalledWith({
      includeDisabled: true,
      limit: 200,
      offset: 0,
      enabled: "all",
      sortBy: "updatedAtMs",
      sortDir: "desc"
    });
    expect(deleteAgent).toHaveBeenCalledWith({
      agentId: "agent-1",
      deleteFiles: false
    });
    expect(removeCronJob).toHaveBeenCalledTimes(2);
    expect(removeCronJob).toHaveBeenCalledWith({ id: "plan-1" });
    expect(removeCronJob).toHaveBeenCalledWith({ id: "plan-3" });
    expect(tokenAdapter.markDigitalEmployeeDeleted).toHaveBeenCalledWith("agent-1");
  });

  it("deleteDigitalHuman defaults to keeping workspace files and scans all cron pages", async () => {
    const deleteAgent = vi.fn().mockResolvedValue({ ok: true });
    const listCronJobs = vi
      .fn()
      .mockResolvedValueOnce({
        jobs: [
          {
            id: "plan-1",
            agentId: "agent-1",
            sessionKey: "agent:agent-1:cron:plan-1:run:run-1",
            name: "Plan 1",
            enabled: true,
            createdAtMs: 1,
            updatedAtMs: 1,
            schedule: {},
            targetType: "session"
          }
        ],
        total: 2,
        offset: 0,
        limit: 200,
        hasMore: true,
        nextOffset: 200
      })
      .mockResolvedValueOnce({
        jobs: [
          {
            id: "plan-2",
            agentId: "agent-1",
            sessionKey: "agent:agent-1:cron:plan-2:run:run-1",
            name: "Plan 2",
            enabled: true,
            createdAtMs: 1,
            updatedAtMs: 1,
            schedule: {},
            targetType: "session"
          }
        ],
        total: 2,
        offset: 200,
        limit: 200,
        hasMore: false,
        nextOffset: null
      });
    const removeCronJob = vi.fn().mockResolvedValue({ removed: true });
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent,
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn(),
        listAgentFiles: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      } as never,
      openClawCronAdapter: stubCronAdapter({
        listCronJobs,
        removeCronJob
      }),
      agentSkillsLogic: stubAgentSkills()
    });

    await logic.deleteDigitalHuman("agent-1");

    expect(listCronJobs).toHaveBeenNthCalledWith(1, expect.objectContaining({ offset: 0 }));
    expect(listCronJobs).toHaveBeenNthCalledWith(2, expect.objectContaining({ offset: 200 }));
    expect(deleteAgent).toHaveBeenCalledWith({
      agentId: "agent-1",
      deleteFiles: false
    });
    expect(removeCronJob).toHaveBeenCalledTimes(2);
  });

  it("deleteDigitalHuman stops when agent deletion fails", async () => {
    const deleteAgent = vi.fn().mockRejectedValue(new Error("unknown agent id"));
    const removeCronJob = vi.fn();
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent,
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn(),
        listAgentFiles: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      } as never,
      openClawCronAdapter: stubCronAdapter({
        listCronJobs: vi.fn().mockResolvedValue({
          jobs: [
            {
              id: "plan-1",
              agentId: "agent-1",
              sessionKey: "agent:agent-1:cron:plan-1:run:run-1",
              name: "Plan 1",
              enabled: true,
              createdAtMs: 1,
              updatedAtMs: 1,
              schedule: {},
              targetType: "session"
            }
          ],
          total: 1,
          offset: 0,
          limit: 200,
          hasMore: false,
          nextOffset: null
        }),
        removeCronJob
      }),
      agentSkillsLogic: stubAgentSkills()
    });

    await expect(logic.deleteDigitalHuman("agent-1")).rejects.toMatchObject({
      statusCode: 404
    });
    expect(removeCronJob).not.toHaveBeenCalled();
  });

  it("createDigitalHuman writes markdown via gateway RPC and configures skills", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"
    );

    const listAgentFiles = vi.fn().mockResolvedValue({
      agentId: "",
      files: [] as { name: string }[]
    });
    const setAgentFile = vi.fn().mockResolvedValue({ ok: true });
    const updateAgentSkills = vi.fn().mockResolvedValue({
      success: true,
      agentId: "",
      skills: ["sk1"]
    });
    const createAgent = vi.fn().mockResolvedValue({ ok: true });
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent,
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile,
        listAgentFiles,
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills({ updateAgentSkills })
    });

    const result = await logic.createDigitalHuman({
      name: "Bob",
      creature: "Dev",
      soul: "Hi",
      skills: ["sk1"]
    });

    const ws = resolveDefaultWorkspace(result.id);
    expect(createAgent).toHaveBeenCalledWith({
      name: result.id,
      workspace: ws
    });
    expect(listAgentFiles).toHaveBeenCalledWith({ agentId: result.id });
    expect(setAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: result.id,
        name: "IDENTITY.md",
        content: expect.stringContaining("Bob") as string
      })
    );
    expect(setAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: result.id,
        name: "SOUL.md",
        content: expect.stringContaining("Hi") as string
      })
    );
    expect(setAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: result.id,
        name: "TOOLS.md",
        content: expect.stringContaining("## 投递通道消息") as string
      })
    );
    expect(updateAgentSkills).toHaveBeenCalledWith(result.id, [
      "archive-protocol",
      "schedule-plan",
      "kweaver-core",
      "sk1"
    ]);
    expect(result.skills).toEqual([
      "archive-protocol",
      "schedule-plan",
      "kweaver-core",
      "sk1"
    ]);
  });

  it("createDigitalHuman writes KWeaver token to the digital employee table", async () => {
    const setAgentFile = vi.fn().mockResolvedValue({ ok: true });
    const getAgentFile = vi.fn();
    const tokenAdapter = stubDigitalEmployeeTokenAdapter();
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent: vi.fn().mockResolvedValue({ ok: true }),
        deleteAgent: vi.fn(),
        getAgentFile,
        setAgentFile,
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills(),
      digitalEmployeeTokenAdapter: tokenAdapter
    });

    const result = await logic.createDigitalHuman({
      id: "agent-secret",
      name: "Secret",
      kweaver_token: "kw-token"
    });

    expect(getAgentFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "SECRET" })
    );
    expect(setAgentFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "SECRET" })
    );
    expect(tokenAdapter.upsertKweaverToken).toHaveBeenCalledWith(
      "agent-secret",
      "kw-token"
    );
    expect(tokenAdapter.deleteKweaverToken).not.toHaveBeenCalled();
  });

  it("createDigitalHuman uses the provided id instead of generating a uuid", async () => {
    const randomUuidSpy = vi.spyOn(globalThis.crypto, "randomUUID");
    const createAgent = vi.fn().mockResolvedValue({ ok: true });
    const listAgentFiles = vi.fn().mockResolvedValue({
      agentId: "",
      files: [] as { name: string }[]
    });
    const setAgentFile = vi.fn().mockResolvedValue({ ok: true });
    const updateAgentSkills = vi.fn().mockResolvedValue({
      success: true,
      agentId: "",
      skills: []
    });
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent,
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile,
        listAgentFiles,
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills({ updateAgentSkills })
    });

    const result = await logic.createDigitalHuman({
      id: "__bkn_creator__",
      name: "BKN Creator"
    });

    expect(randomUuidSpy).not.toHaveBeenCalled();
    expect(createAgent).toHaveBeenCalledWith({
      name: "__bkn_creator__",
      workspace: resolveDefaultWorkspace("__bkn_creator__")
    });
    expect(listAgentFiles).toHaveBeenCalledWith({ agentId: "__bkn_creator__" });
    expect(result.id).toBe("__bkn_creator__");
  });

  it("createDigitalHuman binds default built-in skills when request omits skills", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "dddddddd-dddd-dddd-dddd-dddddddddddd"
    );

    const updateAgentSkills = vi.fn().mockResolvedValue({
      success: true,
      agentId: "",
      skills: []
    });
    const tokenAdapter = stubDigitalEmployeeTokenAdapter();
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent: vi.fn().mockResolvedValue({ ok: true }),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn().mockResolvedValue({ ok: true }),
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills({ updateAgentSkills }),
      digitalEmployeeTokenAdapter: tokenAdapter
    });

    const result = await logic.createDigitalHuman({ name: "NoSkills" });

    expect(updateAgentSkills).toHaveBeenCalledWith(result.id, [
      "archive-protocol",
      "schedule-plan",
      "kweaver-core"
    ]);
    expect(result.skills).toEqual([
      "archive-protocol",
      "schedule-plan",
      "kweaver-core"
    ]);
    expect(tokenAdapter.upsertKweaverToken).toHaveBeenCalledWith(result.id, null);
  });

  it("createDigitalHuman deduplicates repeated request skill names", async () => {
    const updateAgentSkills = vi.fn().mockResolvedValue({
      success: true,
      agentId: "",
      skills: []
    });
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent: vi.fn().mockResolvedValue({ ok: true }),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn().mockResolvedValue({ ok: true }),
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills({ updateAgentSkills })
    });

    const result = await logic.createDigitalHuman({
      name: "Dup",
      skills: ["other", "other", "archive-protocol"]
    });

    expect(updateAgentSkills).toHaveBeenCalledWith(result.id, [
      "archive-protocol",
      "schedule-plan",
      "kweaver-core",
      "other",
    ]);
    expect(result.skills).toEqual([
      "archive-protocol",
      "schedule-plan",
      "kweaver-core",
      "other"
    ]);
  });

  it("getDigitalHuman returns the full bound skill list in the response", async () => {
    const id = "a1b2c3d4-e5f6-7890-abcd-ef1234567891";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(
      join(ws, "IDENTITY.md"),
      "- Name: Alice\n- Creature: QA\n",
      "utf8"
    );
    writeFileSync(join(ws, "SOUL.md"), "Soul text\n", "utf8");

    const adapter = {
      listAgents: vi.fn(),
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
      getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
        file: { content: readFileSync(join(ws, name), "utf8") }
      })),
      setAgentFile: vi.fn(),
      getConfig: vi.fn(),
      patchConfig: vi.fn()
    };

    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: adapter as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills({
        getAgentSkills: vi.fn().mockResolvedValue({
          agentId: id,
          skills: [
            "archive-protocol",
            "schedule-plan",
            "kweaver-core",
            "extra-skill"
          ]
        })
      })
    });

    await expect(logic.getDigitalHuman(id)).resolves.toMatchObject({
      id,
      skills: [
        "archive-protocol",
        "schedule-plan",
        "kweaver-core",
        "extra-skill"
      ]
    });
  });

  it("updateDigitalHuman merges patch and writes files via gateway RPC", async () => {
    const id = "f1e2d3c4-b5a6-7890-abcd-ef1234567890";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(
      join(ws, "IDENTITY.md"),
      "- Name: Old\n- Creature: X\n",
      "utf8"
    );
    writeFileSync(join(ws, "SOUL.md"), "Old soul\n", "utf8");

    const listAgentFiles = vi.fn().mockResolvedValue({ agentId: id, files: [] });
    const setAgentFile = vi.fn().mockResolvedValue({ ok: true });
    const adapter = {
      listAgents: vi.fn(),
      createAgent: vi.fn(),
      deleteAgent: vi.fn(),
      getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
        file: { content: readFileSync(join(ws, name), "utf8") }
      })),
      setAgentFile,
      listAgentFiles,
      getConfig: vi.fn(),
      patchConfig: vi.fn()
    };

    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: adapter as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    await logic.updateDigitalHuman(id, { name: "New", soul: "New soul" });

    expect(listAgentFiles).toHaveBeenCalledWith({ agentId: id });
    expect(setAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: id,
        name: "IDENTITY.md",
        content: expect.stringContaining("New") as string
      })
    );
    expect(setAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: id,
        name: "SOUL.md",
        content: expect.stringContaining("New soul") as string
      })
    );
    expect(setAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: id,
        name: "TOOLS.md",
        content: expect.stringContaining("## 投递通道消息") as string
      })
    );
  });

  it("updateDigitalHuman replaces KWeaver token in the database without changing BKN", async () => {
    const id = "agent-token";
    const setAgentFile = vi.fn().mockResolvedValue({ ok: true });
    const tokenAdapter = stubDigitalEmployeeTokenAdapter();
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
          file: {
            content: name === "IDENTITY.md"
              ? "- Name: Old\n"
              : "## 业务知识网络\n> | 名称 | 地址 |\n> |------|------|\n> | K | kn-1 |\n"
          }
        })),
        setAgentFile,
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: id, files: [] }),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills(),
      digitalEmployeeTokenAdapter: tokenAdapter
    });

    const result = await logic.updateDigitalHuman(id, {
      kweaver_token: "new-token"
    });

    expect(result.bkn).toEqual([{ name: "K", url: "kn-1" }]);
    expect(setAgentFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "SECRET" })
    );
    expect(tokenAdapter.upsertKweaverToken).toHaveBeenCalledWith(id, "new-token");
    expect(tokenAdapter.deleteKweaverToken).not.toHaveBeenCalled();
  });

  it("updateDigitalHuman removes KWeaver token from the database and clears BKN", async () => {
    const id = "agent-token-delete";
    const setAgentFile = vi.fn().mockResolvedValue({ ok: true });
    const tokenAdapter = stubDigitalEmployeeTokenAdapter();
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
          file: {
            content: name === "IDENTITY.md"
              ? "- Name: Old\n"
              : "## 业务知识网络\n> | 名称 | 地址 |\n> |------|------|\n> | K | kn-1 |\n"
          }
        })),
        setAgentFile,
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: id, files: [] }),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills(),
      digitalEmployeeTokenAdapter: tokenAdapter
    });

    const result = await logic.updateDigitalHuman(id, {
      bkn: [{ name: "Ignored", url: "kn-2" }],
      kweaver_token: null
    });

    expect(result.bkn).toEqual([]);
    expect(setAgentFile).not.toHaveBeenCalledWith(
      expect.objectContaining({ name: "SECRET" })
    );
    expect(tokenAdapter.deleteKweaverToken).toHaveBeenCalledWith(id);
    expect(tokenAdapter.upsertKweaverToken).not.toHaveBeenCalled();
    expect(setAgentFile).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "SOUL.md",
        content: expect.not.stringContaining("kn-2") as string
      })
    );
  });

  it("createDigitalHuman binds channel via config.set when gateway accepts", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb"
    );

    const stateDir = join(fakeHome, ".openclaw");
    mkdirSync(stateDir, { recursive: true });
    const cfg = join(stateDir, "openclaw.json");
    writeFileSync(cfg, "{}\n", "utf8");
    const prevState = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = stateDir;

    const createAgent = vi.fn().mockResolvedValue({ ok: true });
    const getConfig = vi.fn().mockResolvedValue({
      raw: JSON.stringify({ models: { provider: "raw-ignored" } }),
      config: { models: { provider: "local" } },
      hash: "base-hash-1"
    });
    const setConfig = vi.fn().mockResolvedValue({ ok: true });
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent,
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn().mockResolvedValue({ ok: true }),
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig,
        patchConfig: vi.fn(),
        setConfig
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    const result = await logic.createDigitalHuman({
      name: "C",
      channel: { appId: "a", appSecret: "b" }
    });

    expect(getConfig).toHaveBeenCalledOnce();
    expect(setConfig).toHaveBeenCalledOnce();
    expect(setConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        baseHash: "base-hash-1"
      })
    );
    const written = JSON.parse(
      (setConfig.mock.calls[0][0] as { raw: string }).raw
    ) as {
      channels: {
        feishu: { accounts: Record<string, { appId: string; appSecret: string }> };
      };
      bindings: Array<{
        agentId: string;
        match: { channel: string; accountId?: string };
      }>;
      models: { provider: string };
    };
    expect(written.models).toEqual({ provider: "local" });
    const accId = normalizeOpenClawAccountIdFromAppId("a");
    expect(written.channels.feishu.accounts[accId]).toMatchObject({
      appId: "a",
      dmPolicy: "open",
      allowFrom: ["*"]
    });
    expect(written.bindings.some((b) => b.agentId === result.id)).toBe(true);
    expect(
      written.bindings.find((b) => b.agentId === result.id)?.match.channel
    ).toBe("feishu");
    expect(
      written.bindings.find((b) => b.agentId === result.id)?.match.accountId
    ).toBe(accId);

    process.env.OPENCLAW_ROOT_DIR = prevState;
  });

  it("createDigitalHuman uses config.set when OPENCLAW_ROOT_DIR resolves config path", async () => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockReturnValue(
      "cccccccc-cccc-cccc-cccc-cccccccccccc"
    );

    const stateDir = join(fakeHome, "state");
    mkdirSync(stateDir, { recursive: true });
    const cfgPath = join(stateDir, "openclaw.json");
    writeFileSync(cfgPath, "{}\n", "utf8");
    const prevState = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = stateDir;

    const createAgent = vi.fn().mockResolvedValue({ ok: true });
    const getConfig = vi.fn().mockResolvedValue({ config: {}, hash: "base-hash-2" });
    const setConfig = vi.fn().mockResolvedValue({ ok: true });
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent,
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn().mockResolvedValue({ ok: true }),
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig,
        patchConfig: vi.fn(),
        setConfig
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    const result = await logic.createDigitalHuman({
      name: "D",
      channel: { appId: "x", appSecret: "y" }
    });

    expect(setConfig).toHaveBeenCalledOnce();
    const written = JSON.parse(
      (setConfig.mock.calls[0][0] as { raw: string }).raw
    ) as {
      channels: {
        feishu: { accounts: Record<string, { appId: string }> };
      };
    };
    const accX = normalizeOpenClawAccountIdFromAppId("x");
    expect(written.channels.feishu.accounts[accX]).toMatchObject({
      appId: "x",
      dmPolicy: "open",
      allowFrom: ["*"]
    });
    const raw = (setConfig.mock.calls[0][0] as { raw: string }).raw;
    expect(raw).toContain(result.id);

    process.env.OPENCLAW_ROOT_DIR = prevState;
  });

  it("getDigitalHuman includes channel when OpenClaw config binds dingtalk via accounts", async () => {
    const id = "f1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(
      join(ws, "IDENTITY.md"),
      "- Name: Alice\n- Creature: QA\n",
      "utf8"
    );
    writeFileSync(join(ws, "SOUL.md"), "Soul text\n", "utf8");

    const rootDir = join(fakeHome, ".openclaw");
    mkdirSync(rootDir, { recursive: true });
    const configPath = join(rootDir, "openclaw.json");
    const accountId = normalizeOpenClawAccountIdFromAppId("ding_app_1");
    writeFileSync(
      configPath,
      JSON.stringify({
        bindings: [
          { agentId: id, match: { channel: "dingtalk", accountId } }
        ],
        channels: {
          dingtalk: {
            enabled: true,
            accounts: {
              [accountId]: {
                enabled: true,
                appId: "ding_app_1",
                appSecret: "dt-sec"
              }
            }
          }
        }
      }),
      "utf8"
    );
    const prev = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = rootDir;

    try {
      const adapter = {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
          file: { content: readFileSync(join(ws, name), "utf8") }
        })),
        setAgentFile: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      };

      const logic = new DefaultDigitalHumanLogic({
        openClawAgentsAdapter: adapter as never,
        openClawCronAdapter: stubCronAdapter(),
        agentSkillsLogic: stubAgentSkills()
      });

      await expect(logic.getDigitalHuman(id)).resolves.toMatchObject({
        id,
        channel: { type: "dingtalk", appId: "ding_app_1", appSecret: "dt-sec" }
      });
    } finally {
      if (prev === undefined) {
        delete process.env.OPENCLAW_ROOT_DIR;
      } else {
        process.env.OPENCLAW_ROOT_DIR = prev;
      }
    }
  });

  it("getDigitalHuman includes channel when OpenClaw config binds dingtalk (legacy top-level)", async () => {
    const id = "f1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const ws = resolveDefaultWorkspace(id);
    mkdirSync(ws, { recursive: true });
    writeFileSync(
      join(ws, "IDENTITY.md"),
      "- Name: Alice\n- Creature: QA\n",
      "utf8"
    );
    writeFileSync(join(ws, "SOUL.md"), "Soul text\n", "utf8");

    const rootDir = join(fakeHome, ".openclaw");
    mkdirSync(rootDir, { recursive: true });
    const configPath = join(rootDir, "openclaw.json");
    writeFileSync(
      configPath,
      JSON.stringify({
        bindings: [{ agentId: id, match: { channel: "dingtalk" } }],
        channels: {
          dingtalk: {
            enabled: true,
            appId: "dt-1",
            appSecret: "dt-sec"
          }
        }
      }),
      "utf8"
    );
    const prev = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = rootDir;

    try {
      const adapter = {
        listAgents: vi.fn(),
        createAgent: vi.fn(),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn().mockImplementation(async ({ name }: { name: string }) => ({
          file: { content: readFileSync(join(ws, name), "utf8") }
        })),
        setAgentFile: vi.fn(),
        getConfig: vi.fn(),
        patchConfig: vi.fn()
      };

      const logic = new DefaultDigitalHumanLogic({
        openClawAgentsAdapter: adapter as never,
        openClawCronAdapter: stubCronAdapter(),
        agentSkillsLogic: stubAgentSkills()
      });

      await expect(logic.getDigitalHuman(id)).resolves.toMatchObject({
        id,
        channel: { type: "dingtalk", appId: "dt-1", appSecret: "dt-sec" }
      });
    } finally {
      if (prev === undefined) {
        delete process.env.OPENCLAW_ROOT_DIR;
      } else {
        process.env.OPENCLAW_ROOT_DIR = prev;
      }
    }
  });

  it("createDigitalHuman binds dingtalk channel when type is dingtalk", async () => {
    const stateDir = join(fakeHome, ".openclaw");
    mkdirSync(stateDir, { recursive: true });
    const cfg = join(stateDir, "openclaw.json");
    writeFileSync(cfg, "{}\n", "utf8");
    const prevState = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = stateDir;

    const createAgent = vi.fn().mockResolvedValue({ ok: true });
    const getConfig = vi.fn().mockResolvedValue({ config: {}, hash: "base-hash-3" });
    const setConfig = vi.fn().mockResolvedValue({ ok: true });
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent,
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn().mockResolvedValue({ ok: true }),
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig,
        patchConfig: vi.fn(),
        setConfig
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    const result = await logic.createDigitalHuman({
      name: "E",
      channel: { type: "dingtalk", appId: "dta", appSecret: "dts" }
    });

    const written = JSON.parse(
      (setConfig.mock.calls[0][0] as { raw: string }).raw
    ) as {
      bindings: Array<{
        agentId: string;
        match: { channel: string; accountId?: string };
      }>;
      channels: {
        dingtalk: { accounts: Record<string, { appId: string; appSecret: string }> };
      };
    };
    const accDta = normalizeOpenClawAccountIdFromAppId("dta");
    expect(written.channels.dingtalk.accounts[accDta].appId).toBe("dta");
    expect(written.bindings.some((b) => b.match.channel === "dingtalk")).toBe(true);
    expect(
      written.bindings.find((b) => b.agentId === result.id)?.match.accountId
    ).toBe(accDta);
    expect(result.channel).toEqual({
      type: "dingtalk",
      appId: "dta",
      appSecret: "dts"
    });

    process.env.OPENCLAW_ROOT_DIR = prevState;
  });

  it("createDigitalHuman refuses config.set when config.get parsed config is missing", async () => {
    const createAgent = vi.fn().mockResolvedValue({ ok: true });
    const setConfig = vi.fn().mockResolvedValue({ ok: true });
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent,
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn().mockResolvedValue({ ok: true }),
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig: vi.fn().mockResolvedValue({ raw: "{ not json", hash: "h-invalid" }),
        patchConfig: vi.fn(),
        setConfig
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    await expect(logic.createDigitalHuman({
      name: "Invalid Config",
      channel: { appId: "invalid-raw-app", appSecret: "sec" }
    })).rejects.toMatchObject({
      statusCode: 502,
      message:
        "OpenClaw config.get did not return a parsed config object; refusing to call config.set"
    });
    expect(setConfig).not.toHaveBeenCalled();
  });

  it("createDigitalHuman uses parsed config when config.get raw is absent", async () => {
    const setConfig = vi.fn().mockResolvedValue({ ok: true });
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent: vi.fn().mockResolvedValue({ ok: true }),
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn().mockResolvedValue({ ok: true }),
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig: vi.fn().mockResolvedValue({
          config: {
            models: { provider: "from-parsed" },
            channels: { feishu: { enabled: true } }
          },
          hash: "h-redacted"
        }),
        patchConfig: vi.fn(),
        setConfig
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    await logic.createDigitalHuman({
      name: "Redacted Config",
      channel: { appId: "redacted-app", appSecret: "sec" }
    });
    expect(setConfig).toHaveBeenCalledOnce();
    const written = JSON.parse(
      (setConfig.mock.calls[0][0] as { raw: string }).raw
    ) as {
      models: { provider: string };
      channels: { feishu: { enabled: boolean } };
    };
    expect(written.models).toEqual({ provider: "from-parsed" });
    expect(written.channels.feishu.enabled).toBe(true);
  });

  it("createDigitalHuman rejects a Feishu app id already present in config.get", async () => {
    const stateDir = join(fakeHome, ".openclaw");
    mkdirSync(stateDir, { recursive: true });
    const cfg = join(stateDir, "openclaw.json");
    writeFileSync(cfg, "{}\n", "utf8");
    const prevState = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = stateDir;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setConfig = vi.fn().mockResolvedValue({ ok: true });
    const createAgent = vi.fn().mockResolvedValue({ ok: true });
    const acc = normalizeOpenClawAccountIdFromAppId("cli_shared_app");
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent,
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn().mockResolvedValue({ ok: true }),
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig: vi.fn().mockResolvedValue({
          config: {
            bindings: [
              { agentId: "existing-agent", match: { channel: "feishu", accountId: acc } }
            ],
            channels: {
              feishu: {
                accounts: {
                  [acc]: { appId: "cli_shared_app", appSecret: "old" }
                }
              }
            }
          },
          hash: "h"
        }),
        patchConfig: vi.fn(),
        setConfig
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    await expect(logic.createDigitalHuman({
      name: "Second",
      channel: { appId: "cli_shared_app", appSecret: "s2" }
    })).rejects.toMatchObject({
      statusCode: 400,
      message: "channel.appId has already been configured for feishu"
    });
    expect(setConfig).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    process.env.OPENCLAW_ROOT_DIR = prevState;
  });

  it("createDigitalHuman rejects a DingTalk app id already present in config.get", async () => {
    const stateDir = join(fakeHome, ".openclaw");
    mkdirSync(stateDir, { recursive: true });
    const cfg = join(stateDir, "openclaw.json");
    writeFileSync(cfg, "{}\n", "utf8");
    const prevState = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = stateDir;

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const setConfig = vi.fn().mockResolvedValue({ ok: true });
    const createAgent = vi.fn().mockResolvedValue({ ok: true });
    const acc = normalizeOpenClawAccountIdFromAppId("ding_shared_app");
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent,
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn().mockResolvedValue({ ok: true }),
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig: vi.fn().mockResolvedValue({
          config: {
            bindings: [
              { agentId: "existing-agent", match: { channel: "dingtalk", accountId: acc } }
            ],
            channels: {
              dingtalk: {
                accounts: {
                  [acc]: { appId: "ding_shared_app", appSecret: "old" }
                }
              }
            }
          },
          hash: "h"
        }),
        patchConfig: vi.fn(),
        setConfig
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    await expect(logic.createDigitalHuman({
      name: "Second",
      channel: { type: "dingtalk", appId: "ding_shared_app", appSecret: "s2" }
    })).rejects.toMatchObject({
      statusCode: 400,
      message: "channel.appId has already been configured for dingtalk"
    });
    expect(setConfig).not.toHaveBeenCalled();

    warnSpy.mockRestore();
    process.env.OPENCLAW_ROOT_DIR = prevState;
  });

  it("createDigitalHuman does not write openclaw.json when config.set fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const stateDir = join(fakeHome, ".openclaw");
    mkdirSync(stateDir, { recursive: true });
    const cfg = join(stateDir, "openclaw.json");
    writeFileSync(cfg, "{}\n", "utf8");
    const prevState = process.env.OPENCLAW_ROOT_DIR;
    process.env.OPENCLAW_ROOT_DIR = stateDir;

    const createAgent = vi.fn().mockResolvedValue({ ok: true });
    const getConfig = vi.fn().mockResolvedValue({ config: {}, hash: "h" });
    const setConfig = vi.fn().mockRejectedValue(new Error("validation failed"));
    const logic = new DefaultDigitalHumanLogic({
      openClawAgentsAdapter: {
        listAgents: vi.fn(),
        createAgent,
        deleteAgent: vi.fn(),
        getAgentFile: vi.fn(),
        setAgentFile: vi.fn().mockResolvedValue({ ok: true }),
        listAgentFiles: vi.fn().mockResolvedValue({ agentId: "", files: [] }),
        getConfig,
        patchConfig: vi.fn(),
        setConfig
      } as never,
      openClawCronAdapter: stubCronAdapter(),
      agentSkillsLogic: stubAgentSkills()
    });

    const result = await logic.createDigitalHuman({
      name: "F",
      channel: { appId: "fb", appSecret: "sec" }
    });

    expect(result.channel).toEqual({
      type: "feishu",
      appId: "fb",
      appSecret: "sec"
    });
    expect(readFileSync(cfg, "utf8")).toBe("{}\n");
    expect(errorSpy).toHaveBeenCalledWith(
      "[digital-human] channel binding failed (non-fatal):",
      expect.any(Error)
    );

    errorSpy.mockRestore();
    process.env.OPENCLAW_ROOT_DIR = prevState;
  });
});
