import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let fakeHomeForOsMock = "/tmp";

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  return {
    ...actual,
    homedir: (): string => fakeHomeForOsMock
  };
});

import {
  DefaultChannelUserLogic,
  buildExportFilename,
  deriveChannelUserId,
  parseChannelUsersJsonl,
  readChannelUsersFile,
  resolveChannelUsersFilePath
} from "./channel-user";

/**
 * Creates a minimal OpenClaw adapter mock for channel-user logic tests.
 *
 * @param overrides Optional adapter overrides.
 * @returns Mocked adapter.
 */
function createAdapterMock(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    getConfig: vi.fn().mockResolvedValue({
      raw: JSON.stringify({}),
      hash: "hash-1"
    }),
    patchConfig: vi.fn().mockResolvedValue({ ok: true }),
    ...overrides
  };
}

describe("parseChannelUsersJsonl", () => {
  it("parses valid JSONL channel users", () => {
    const result = parseChannelUsersJsonl(
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"o-2\"}}"
      ].join("\n")
    );

    expect(result.errors).toEqual([]);
    expect(result.users).toHaveLength(2);
    expect(result.users[0]).toMatchObject({
      id: deriveChannelUserId("feishu", "o-1"),
      displayName: "Alice",
      channel: { type: "feishu", user_id: "o-1" }
    });
  });

  it("reports duplicate reasons on later lines", () => {
    const result = parseChannelUsersJsonl(
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-2\"}}",
        "{\"displayName\":\"Carol\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"o-1\"}}"
      ].join("\n")
    );

    expect(result.errors).toEqual([
      expect.objectContaining({
        line: 2,
        reason: "与前面记录重复：displayName + channel.type 组合已存在"
      }),
      expect.objectContaining({
        line: 3,
        reason: "与前面记录重复：channel.user_id 已存在"
      })
    ]);
  });

  it("reports malformed rows and missing fields", () => {
    const result = parseChannelUsersJsonl(
      [
        "not-json",
        "{\"displayName\":\"Alice\"}",
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"slack\",\"user_id\":\"o-1\"}}"
      ].join("\n")
    );

    expect(result.errors).toEqual([
      expect.objectContaining({ line: 1, reason: "JSON 解析失败" }),
      expect.objectContaining({ line: 2, reason: "缺少字段 channel" }),
      expect.objectContaining({ line: 3, reason: "channel.type 必须为 feishu 或 dingding" })
    ]);
  });

  it("reports non-object rows and missing channel fields", () => {
    const result = parseChannelUsersJsonl(
      [
        "[]",
        "{\"displayName\":\"Alice\"}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"feishu\"}}"
      ].join("\n")
    );

    expect(result.errors).toEqual([
      expect.objectContaining({ line: 1, reason: "记录必须是 JSON 对象" }),
      expect.objectContaining({ line: 2, reason: "缺少字段 channel" }),
      expect.objectContaining({ line: 3, reason: "缺少字段 channel.user_id" })
    ]);
  });

  it("rejects records that still contain id", () => {
    const result = parseChannelUsersJsonl(
      "{\"id\":\"legacy\",\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}"
    );

    expect(result.errors).toEqual([
      expect.objectContaining({ line: 1, reason: "字段 id 不允许出现" })
    ]);
  });
});

describe("buildExportFilename", () => {
  it("formats the expected JSONL filename", () => {
    expect(buildExportFilename(new Date("2026-04-16T15:16:08"))).toBe(
      "通道用户_2026_04_16_15_16_08.jsonl"
    );
  });
});

describe("DefaultChannelUserLogic", () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "dip-channel-user-"));
    fakeHomeForOsMock = fakeHome;
    mkdirSync(join(fakeHome, ".openclaw", "workspace"), { recursive: true });
  });

  afterEach(() => {
    fakeHomeForOsMock = "/tmp";
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("lists channel users with partial displayName filtering and pagination", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      [
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"o-2\"}}",
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"o-3\"}}"
      ].join("\n"),
      "utf-8"
    );

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });
    const result = await logic.listChannelUsers({
      displayName: "Alice",
      start: 0,
      limit: 1
    });

    expect(result.total).toBe(2);
    expect(result.items).toEqual([
      {
        displayName: "Alice",
        channel: { type: "dingding", user_id: "o-3" }
      }
    ]);
  });

  it("matches channel users by partial displayName", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      [
        "{\"displayName\":\"王子\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"王子文\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-2\"}}",
        "{\"displayName\":\"数学王子\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"o-3\"}}",
        "{\"displayName\":\"小明\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-4\"}}"
      ].join("\n"),
      "utf-8"
    );

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });
    const result = await logic.listChannelUsers({ displayName: "王子" });

    expect(result.items).toEqual([
      {
        displayName: "数学王子",
        channel: { type: "dingding", user_id: "o-3" }
      },
      {
        displayName: "王子",
        channel: { type: "feishu", user_id: "o-1" }
      },
      {
        displayName: "王子文",
        channel: { type: "feishu", user_id: "o-2" }
      }
    ]);
  });

  it("matches channel users by displayName case-insensitively", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"ALINA\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"o-2\"}}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-3\"}}"
      ].join("\n"),
      "utf-8"
    );

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });
    const result = await logic.listChannelUsers({ displayName: "ali" });

    expect(result.items).toEqual([
      {
        displayName: "Alice",
        channel: { type: "feishu", user_id: "o-1" }
      },
      {
        displayName: "ALINA",
        channel: { type: "dingding", user_id: "o-2" }
      }
    ]);
  });

  it("normalizes invalid pagination values", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-2\"}}"
      ].join("\n"),
      "utf-8"
    );

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });
    const result = await logic.listChannelUsers({
      start: -1,
      limit: 999
    });

    expect(result.start).toBe(0);
    expect(result.limit).toBe(200);
  });

  it("lists digital-human channel users by allowFrom", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-2\"}}",
        "{\"displayName\":\"Carol\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"o-3\"}}"
      ].join("\n"),
      "utf-8"
    );
    writeFileSync(
      join(fakeHome, ".openclaw", "openclaw.json"),
      JSON.stringify({
        bindings: [
          {
            agentId: "agent-1",
            match: {
              channel: "feishu",
              accountId: "cli-app"
            }
          }
        ],
        channels: {
          feishu: {
            accounts: {
              "cli-app": {
                allowFrom: ["o-2"]
              }
            }
          }
        }
      }),
      "utf-8"
    );

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });
    const result = await logic.listDigitalHumanChannelUsers("agent-1", {});

    expect(result.items).toEqual([
      {
        displayName: "Bob",
        channel: { type: "feishu", user_id: "o-2" }
      }
    ]);
  });

  it("returns all same-channel users when allowFrom is wildcard", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-2\"}}",
        "{\"displayName\":\"Carol\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"o-3\"}}"
      ].join("\n"),
      "utf-8"
    );
    writeFileSync(
      join(fakeHome, ".openclaw", "openclaw.json"),
      JSON.stringify({
        bindings: [
          {
            agentId: "agent-1",
            match: {
              channel: "feishu",
              accountId: "cli-app"
            }
          }
        ],
        channels: {
          feishu: {
            accounts: {
              "cli-app": {
                allowFrom: ["*"]
              }
            }
          }
        }
      }),
      "utf-8"
    );

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });
    const result = await logic.listDigitalHumanChannelUsers("agent-1", {});

    expect(result.total).toBe(2);
    expect(result.items.every((item) => item.channel.type === "feishu")).toBe(true);
  });

  it("rejects list scoping when the digital human binding is missing", async () => {
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });

    await expect(logic.listDigitalHumanChannelUsers("missing", {})).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("rejects list scoping when the binding shape is invalid", async () => {
    writeFileSync(
      join(fakeHome, ".openclaw", "openclaw.json"),
      JSON.stringify({
        bindings: [
          {
            agentId: "agent-1",
            match: null
          }
        ]
      }),
      "utf-8"
    );
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });

    await expect(logic.listDigitalHumanChannelUsers("agent-1", {})).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("rejects list scoping when the bound account is missing", async () => {
    writeFileSync(
      join(fakeHome, ".openclaw", "openclaw.json"),
      JSON.stringify({
        bindings: [
          {
            agentId: "agent-1",
            match: {
              channel: "feishu",
              accountId: "cli-app"
            }
          }
        ],
        channels: {
          feishu: {
            accounts: {}
          }
        }
      }),
      "utf-8"
    );
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });

    await expect(logic.listDigitalHumanChannelUsers("agent-1", {})).rejects.toMatchObject({
      statusCode: 404
    });
  });

  it("creates and persists a channel user", async () => {
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });

    const created = await logic.createChannelUser({
      displayName: "Alice",
      channel: {
        type: "feishu",
        user_id: "o-1"
      }
    });

    expect(created.id).toBe(deriveChannelUserId("feishu", "o-1"));
    const persisted = readFileSync(resolveChannelUsersFilePath(), "utf-8");
    expect(persisted).toContain("\"displayName\":\"Alice\"");
    expect(persisted).not.toContain("\"id\"");
  });

  it("returns an empty list when the persisted file does not exist", async () => {
    await expect(readChannelUsersFile()).resolves.toEqual([]);
  });

  it("rejects duplicate channel user combinations", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n",
      "utf-8"
    );

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });

    await expect(
      logic.createChannelUser({
        displayName: "Alice",
        channel: {
          type: "feishu",
          user_id: "o-2"
        }
      })
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it("throws when updating a missing channel user", async () => {
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });

    await expect(
      logic.updateChannelUser("missing", {
        displayName: "Alice",
        channel: {
          type: "feishu",
          user_id: "o-1"
        }
      })
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it("rewrites allowFrom values when a channel user user_id changes", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n",
      "utf-8"
    );
    const patchConfig = vi.fn().mockResolvedValue({ ok: true });
    const config = {
      channels: {
        feishu: {
          accounts: {
            "cli-app": {
              allowFrom: ["o-1", "o-1", ""]
            }
          }
        }
      }
    };
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock({
        getConfig: vi.fn().mockResolvedValue({
          raw: JSON.stringify(config),
          hash: "hash-1"
        }),
        patchConfig
      }) as never
    });

    await logic.updateChannelUser(deriveChannelUserId("feishu", "o-1"), {
      displayName: "Alice",
      channel: {
        type: "feishu",
        user_id: "o-9"
      }
    });

    expect(patchConfig).toHaveBeenCalledWith({
      raw: JSON.stringify({
        channels: {
          feishu: {
            accounts: {
              "cli-app": {
                allowFrom: ["o-9"]
              }
            }
          }
        }
      }),
      baseHash: "hash-1"
    });
  });

  it("deletes a channel user and removes allowFrom references", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-2\"}}"
      ].join("\n"),
      "utf-8"
    );
    writeFileSync(
      join(fakeHome, ".openclaw", "openclaw.json"),
      JSON.stringify({
        channels: {
          feishu: {
            accounts: {
              "cli-app": {
                allowFrom: ["o-1", "o-2"]
              }
            }
          }
        }
      }),
      "utf-8"
    );
    const patchConfig = vi.fn().mockResolvedValue({ ok: true });
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock({
        getConfig: vi.fn().mockResolvedValue({
          raw: JSON.stringify({
            channels: {
              feishu: {
                accounts: {
                  "cli-app": {
                    allowFrom: ["o-1", "o-2"]
                  }
                }
              }
            }
          }),
          hash: "hash-1"
        }),
        patchConfig
      }) as never
    });

    await logic.deleteChannelUser(deriveChannelUserId("feishu", "o-1"));

    expect(patchConfig).toHaveBeenCalledWith({
      raw: JSON.stringify({
        channels: {
          feishu: {
            accounts: {
              "cli-app": {
                allowFrom: ["o-2"]
              }
            }
          }
        }
      }),
      baseHash: "hash-1"
    });
  });

  it("throws when deleting a missing channel user", async () => {
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });

    await expect(logic.deleteChannelUser("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("imports channel users and prunes stale allowFrom values", async () => {
    const patchConfig = vi.fn().mockResolvedValue({ ok: true });
    const config = {
      channels: {
        feishu: {
          accounts: {
            "cli-app": {
              allowFrom: ["o-1", "stale"]
            }
          }
        },
        dingtalk: {
          accounts: {
            dta: {
              allowFrom: ["ding-1", "*"]
            }
          }
        }
      }
    };
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock({
        getConfig: vi.fn().mockResolvedValue({
          raw: JSON.stringify(config),
          hash: "hash-1"
        }),
        patchConfig
      }) as never
    });

    const result = await logic.importChannelUsers(
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"ding-1\"}}"
      ].join("\n")
    );

    expect(result).toEqual({ count: 2 });
    expect(patchConfig).toHaveBeenCalledWith({
      raw: JSON.stringify({
        channels: {
          feishu: {
            accounts: {
              "cli-app": {
                allowFrom: ["o-1"]
              }
            }
          },
          dingtalk: {
            accounts: {
              dta: {
                allowFrom: ["ding-1", "*"]
              }
            }
          }
        }
      }),
      baseHash: "hash-1"
    });
  });

  it("ignores non-object account entries while pruning imported allowFrom values", async () => {
    const patchConfig = vi.fn().mockResolvedValue({ ok: true });
    const config = {
      channels: {
        feishu: {
          accounts: {
            "cli-app": {
              allowFrom: ["o-1", "stale"]
            },
            broken: "oops"
          }
        }
      }
    };
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock({
        getConfig: vi.fn().mockResolvedValue({
          raw: JSON.stringify(config),
          hash: "hash-1"
        }),
        patchConfig
      }) as never
    });

    await logic.importChannelUsers(
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}"
    );

    expect(patchConfig).toHaveBeenCalledWith({
      raw: JSON.stringify({
        channels: {
          feishu: {
            accounts: {
              "cli-app": {
                allowFrom: ["o-1"]
              },
              broken: "oops"
            }
          }
        }
      }),
      baseHash: "hash-1"
    });
  });

  it("returns structured import validation details on invalid JSONL", async () => {
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });

    await expect(logic.importChannelUsers("not-json")).rejects.toMatchObject({
      statusCode: 400,
      code: "DipStudio.InvalidParameter",
      detail: {
        errors: [expect.objectContaining({ line: 1, reason: "JSON 解析失败" })]
      }
    });
  });

  it("preserves local config content when config.get returns invalid JSON during patch", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n",
      "utf-8"
    );
    const patchConfig = vi.fn().mockResolvedValue({ ok: true });
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock({
        getConfig: vi.fn().mockResolvedValue({
          raw: "[]",
          hash: "hash-1"
        }),
        patchConfig
      }) as never
    });

    await logic.importChannelUsers(
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}"
    );

    expect(patchConfig).toHaveBeenCalledWith({
      raw: JSON.stringify({}),
      baseHash: "hash-1"
    });
  });

  it("keeps the local mutation when config.get returns malformed JSON text", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n",
      "utf-8"
    );
    const patchConfig = vi.fn().mockResolvedValue({ ok: true });
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock({
        getConfig: vi.fn().mockResolvedValue({
          raw: "{",
          hash: "hash-1"
        }),
        patchConfig
      }) as never
    });

    await logic.importChannelUsers(
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}"
    );

    expect(patchConfig).toHaveBeenCalledWith({
      raw: JSON.stringify({}),
      baseHash: "hash-1"
    });
  });

  it("updates one digital human allowFrom list by selected channel user user_ids", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-2\"}}"
      ].join("\n"),
      "utf-8"
    );

    const patchConfig = vi.fn().mockResolvedValue({ ok: true });
    const config = {
      bindings: [
        {
          agentId: "agent-1",
          match: {
            channel: "feishu",
            accountId: "cli-app"
          }
        }
      ],
      channels: {
        feishu: {
          accounts: {
            "cli-app": {
              allowFrom: ["o-1"]
            }
          }
        }
      }
    };
    writeFileSync(join(fakeHome, ".openclaw", "openclaw.json"), JSON.stringify(config), "utf-8");

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock({
        getConfig: vi.fn().mockResolvedValue({
          raw: JSON.stringify(config),
          hash: "hash-1"
        }),
        patchConfig
      }) as never
    });

    const result = await logic.updateDigitalHumanChannelUsers("agent-1", {
      allowFrom: ["o-2", "o-1"]
    });

    expect(result).toEqual({
      digitalHumanId: "agent-1",
      channelType: "feishu",
      allowFrom: ["o-2", "o-1"]
    });
    expect(patchConfig).toHaveBeenCalledWith({
      raw: JSON.stringify({
        bindings: [
          {
            agentId: "agent-1",
            match: {
              channel: "feishu",
              accountId: "cli-app"
            }
          }
        ],
        channels: {
          feishu: {
            accounts: {
              "cli-app": {
                allowFrom: ["o-2", "o-1"]
              }
            }
          }
        }
      }),
      baseHash: "hash-1"
    });
  });

  it("rejects channel user user_ids from a different channel when updating digital human scope", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"ding-1\"}}\n",
      "utf-8"
    );
    const config = {
      bindings: [
        {
          agentId: "agent-1",
          match: {
            channel: "feishu",
            accountId: "cli-app"
          }
        }
      ],
      channels: {
        feishu: {
          accounts: {
            "cli-app": {
              allowFrom: []
            }
          }
        }
      }
    };
    writeFileSync(join(fakeHome, ".openclaw", "openclaw.json"), JSON.stringify(config), "utf-8");

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });

    await expect(
      logic.updateDigitalHumanChannelUsers("agent-1", {
        allowFrom: ["ding-1"]
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("rejects unknown channel user user_ids when updating digital human scope", async () => {
    writeFileSync(
      join(fakeHome, ".openclaw", "openclaw.json"),
      JSON.stringify({
        bindings: [
          {
            agentId: "agent-1",
            match: {
              channel: "feishu",
              accountId: "cli-app"
            }
          }
        ],
        channels: {
          feishu: {
            accounts: {
              "cli-app": {
                allowFrom: []
              }
            }
          }
        }
      }),
      "utf-8"
    );

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never
    });

    await expect(
      logic.updateDigitalHumanChannelUsers("agent-1", {
        allowFrom: ["missing-user_id"]
      })
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it("falls back to writing local openclaw.json when config.patch fails", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n",
      "utf-8"
    );
    writeFileSync(
      join(fakeHome, ".openclaw", "openclaw.json"),
      JSON.stringify({
        bindings: [
          {
            agentId: "agent-1",
            match: {
              channel: "feishu",
              accountId: "cli-app"
            }
          }
        ],
        channels: {
          feishu: {
            accounts: {
              "cli-app": {
                allowFrom: []
              }
            }
          }
        }
      }),
      "utf-8"
    );
    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock({
        getConfig: vi.fn().mockRejectedValue(new Error("gateway unavailable")),
        patchConfig: vi.fn().mockRejectedValue(new Error("gateway unavailable"))
      }) as never
    });

    await logic.updateDigitalHumanChannelUsers("agent-1", {
      allowFrom: ["o-1"]
    });

    const raw = readFileSync(join(fakeHome, ".openclaw", "openclaw.json"), "utf-8");
    expect(raw).toContain("\"allowFrom\": [");
    expect(raw).toContain("\"o-1\"");
  });

  it("updates the default account when binding accountId is missing", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n",
      "utf-8"
    );
    const patchConfig = vi.fn().mockResolvedValue({ ok: true });
    const config = {
      bindings: [
        {
          agentId: "agent-1",
          match: {
            channel: "feishu"
          }
        }
      ],
      channels: {
        feishu: {
          accounts: {
            default: {
              allowFrom: []
            }
          }
        }
      }
    };
    writeFileSync(join(fakeHome, ".openclaw", "openclaw.json"), JSON.stringify(config), "utf-8");

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock({
        getConfig: vi.fn().mockResolvedValue({
          raw: JSON.stringify(config),
          hash: "hash-1"
        }),
        patchConfig
      }) as never
    });

    await logic.updateDigitalHumanChannelUsers("agent-1", {
      allowFrom: ["o-1"]
    });

    expect(patchConfig).toHaveBeenCalledWith({
      raw: JSON.stringify({
        bindings: [
          {
            agentId: "agent-1",
            match: {
              channel: "feishu"
            }
          }
        ],
        channels: {
          feishu: {
            accounts: {
              default: {
                allowFrom: ["o-1"]
              }
            }
          }
        }
      }),
      baseHash: "hash-1"
    });
  });

  it("rejects invalid persisted channel user files", async () => {
    writeFileSync(resolveChannelUsersFilePath(), "not-json", "utf-8");

    await expect(readChannelUsersFile()).rejects.toMatchObject({ statusCode: 500 });
  });

  it("exports raw persisted JSONL with the expected filename", async () => {
    const rawContent = [
      "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"o-2\"}}",
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}"
    ].join("\n");
    writeFileSync(
      resolveChannelUsersFilePath(),
      `${rawContent}\n`,
      "utf-8"
    );

    const logic = new DefaultChannelUserLogic({
      openClawAgentsAdapter: createAdapterMock() as never,
      now: () => new Date("2026-04-16T15:16:08")
    });
    const result = await logic.exportChannelUsers();

    expect(result.filename).toBe("通道用户_2026_04_16_15_16_08.jsonl");
    expect(result.content).toBe(`${rawContent}\n`);
    expect(result.content).not.toContain("\"id\":");
  });
});
