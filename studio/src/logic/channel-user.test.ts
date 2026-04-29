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

    const logic = new DefaultChannelUserLogic();
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

    const logic = new DefaultChannelUserLogic();
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

    const logic = new DefaultChannelUserLogic();
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

    const logic = new DefaultChannelUserLogic();
    const result = await logic.listChannelUsers({
      start: -1,
      limit: 999
    });

    expect(result.start).toBe(0);
    expect(result.limit).toBe(200);
  });

  it("creates and persists a channel user", async () => {
    const logic = new DefaultChannelUserLogic();

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

    const logic = new DefaultChannelUserLogic();

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
    const logic = new DefaultChannelUserLogic();

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

  it("updates and persists a channel user", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n",
      "utf-8"
    );
    const logic = new DefaultChannelUserLogic();

    const result = await logic.updateChannelUser(deriveChannelUserId("feishu", "o-1"), {
      displayName: "Alice",
      channel: {
        type: "feishu",
        user_id: "o-9"
      }
    });

    expect(result.channel.user_id).toBe("o-9");
    expect(readFileSync(resolveChannelUsersFilePath(), "utf-8")).toContain("\"user_id\":\"o-9\"");
  });

  it("deletes and persists a channel user", async () => {
    writeFileSync(
      resolveChannelUsersFilePath(),
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-2\"}}"
      ].join("\n"),
      "utf-8"
    );
    const logic = new DefaultChannelUserLogic();

    await logic.deleteChannelUser(deriveChannelUserId("feishu", "o-1"));

    const persisted = readFileSync(resolveChannelUsersFilePath(), "utf-8");
    expect(persisted).not.toContain("\"user_id\":\"o-1\"");
    expect(persisted).toContain("\"user_id\":\"o-2\"");
  });

  it("throws when deleting a missing channel user", async () => {
    const logic = new DefaultChannelUserLogic();

    await expect(logic.deleteChannelUser("missing")).rejects.toMatchObject({ statusCode: 404 });
  });

  it("imports channel users", async () => {
    const logic = new DefaultChannelUserLogic();

    const result = await logic.importChannelUsers(
      [
        "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}",
        "{\"displayName\":\"Bob\",\"channel\":{\"type\":\"dingding\",\"user_id\":\"ding-1\"}}"
      ].join("\n")
    );

    expect(result).toEqual({ count: 2 });
    expect(readFileSync(resolveChannelUsersFilePath(), "utf-8")).toContain("\"displayName\":\"Alice\"");
    expect(readFileSync(resolveChannelUsersFilePath(), "utf-8")).toContain("\"displayName\":\"Bob\"");
  });

  it("returns structured import validation details on invalid JSONL", async () => {
    const logic = new DefaultChannelUserLogic();

    await expect(logic.importChannelUsers("not-json")).rejects.toMatchObject({
      statusCode: 400,
      code: "DipStudio.InvalidParameter",
      detail: {
        errors: [expect.objectContaining({ line: 1, reason: "JSON 解析失败" })]
      }
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
      now: () => new Date("2026-04-16T15:16:08")
    });
    const result = await logic.exportChannelUsers();

    expect(result.filename).toBe("通道用户_2026_04_16_15_16_08.jsonl");
    expect(result.content).toBe(`${rawContent}\n`);
    expect(result.content).not.toContain("\"id\":");
  });
});
