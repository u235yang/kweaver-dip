import type { NextFunction, Request, Response, Router } from "express";
import { describe, expect, it, vi } from "vitest";

import type { ChannelUserLogic } from "../logic/channel-user";
import { readChannelUserListQuery } from "./channel-user-query";
import { createChannelUserRouter } from "./channel-user";

/**
 * Creates a minimal response double with Express-like chaining.
 *
 * @returns Mocked response.
 */
function createResponseDouble(): Response {
  const response = {
    status: vi.fn(),
    json: vi.fn(),
    end: vi.fn(),
    send: vi.fn(),
    setHeader: vi.fn()
  } as unknown as Response;

  vi.mocked(response.status).mockReturnValue(response);
  return response;
}

/**
 * Creates a minimal channel-user logic double.
 *
 * @param overrides Method overrides for a specific test.
 * @returns Mocked channel-user logic.
 */
function createChannelUserLogicDouble(overrides: Partial<ChannelUserLogic> = {}): ChannelUserLogic {
  return {
    listChannelUsers: vi.fn(),
    listDigitalHumanChannelUsers: vi.fn(),
    importChannelUsers: vi.fn(),
    exportChannelUsers: vi.fn(),
    updateDigitalHumanChannelUsers: vi.fn(),
    ...overrides
  };
}

/**
 * Finds a route handler by method and path.
 *
 * @param router Express router.
 * @param method HTTP method.
 * @param path Route path.
 * @param index Handler index within the route stack.
 * @returns Route handler when found.
 */
function findHandler(
  router: Router,
  method: "get" | "post" | "put" | "delete",
  path: string,
  index = 0
): ((request: Request, response: Response, next: NextFunction) => void | Promise<void>) | undefined {
  const layer = (router as Router & {
    stack: Array<{
      route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{
          handle: (request: Request, response: Response, next: NextFunction) => void | Promise<void>;
        }>;
      };
    }>;
  }).stack.find((entry) => entry.route?.path === path && entry.route.methods[method]);

  return layer?.route?.stack[index]?.handle;
}

describe("readChannelUserListQuery", () => {
  it("parses supported query parameters", () => {
    expect(
      readChannelUserListQuery({
        type: "feishu",
        displayName: "Alice",
        start: "10",
        limit: "20"
      })
    ).toEqual({
      type: "feishu",
      displayName: "Alice",
      start: 10,
      limit: 20
    });
  });

  it("rejects invalid numeric and type query parameters", () => {
    expect(() => readChannelUserListQuery({ start: "1.5" })).toThrow("start must be an integer");
    expect(() => readChannelUserListQuery({ type: "slack" })).toThrow('type must be "feishu" or "dingding"');
    expect(() => readChannelUserListQuery({ limit: {} as unknown as string })).toThrow("limit must be an integer");
  });

  it("omits empty optional query parameters", () => {
    expect(
      readChannelUserListQuery({
        displayName: " ",
        digitalHumanId: "agent-1"
      })
    ).toEqual({});
  });
});

describe("createChannelUserRouter", () => {
  it("returns the channel user list", async () => {
    const response = createResponseDouble();
    const next = vi.fn<NextFunction>();
    const router = createChannelUserRouter(createChannelUserLogicDouble({
      listChannelUsers: vi.fn().mockResolvedValue({
        items: [{ displayName: "Alice", channel: { type: "feishu", user_id: "o-1" } }],
        total: 1,
        start: 0,
        limit: 50
      })
    }));

    await findHandler(router as Router, "get", "/api/dip-studio/v1/channel-users")?.(
      { query: {} } as unknown as Request,
      response,
      next
    );

    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      items: [{ displayName: "Alice", channel: { type: "feishu", user_id: "o-1" } }],
      total: 1,
      start: 0,
      limit: 50
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("wraps unexpected list failures as 502", async () => {
    const response = createResponseDouble();
    const next = vi.fn<NextFunction>();
    const router = createChannelUserRouter(createChannelUserLogicDouble({
      listChannelUsers: vi.fn().mockRejectedValue(new Error("boom"))
    }));

    await findHandler(router as Router, "get", "/api/dip-studio/v1/channel-users")?.(
      { query: {} } as unknown as Request,
      response,
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 502,
        message: "Failed to query channel users"
      })
    );
  });

  it("does not register single-record create, update, or delete routes", () => {
    const router = createChannelUserRouter(createChannelUserLogicDouble());

    expect(findHandler(router as Router, "post", "/api/dip-studio/v1/channel-users")).toBeUndefined();
    expect(findHandler(router as Router, "put", "/api/dip-studio/v1/channel-users/:id")).toBeUndefined();
    expect(findHandler(router as Router, "delete", "/api/dip-studio/v1/channel-users/:id")).toBeUndefined();
  });

  it("exports JSONL as attachment", async () => {
    const response = createResponseDouble();
    const next = vi.fn<NextFunction>();
    const router = createChannelUserRouter(createChannelUserLogicDouble({
      exportChannelUsers: vi.fn().mockResolvedValue({
        filename: "通道用户_2026_04_16_15_16_08.jsonl",
        content: "{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n"
      })
    }));

    await findHandler(router as Router, "get", "/api/dip-studio/v1/channel-users/export")?.(
      {} as Request,
      response,
      next
    );

    expect(response.setHeader).toHaveBeenCalledWith(
      "Content-Type",
      "application/x-ndjson; charset=utf-8"
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.send).toHaveBeenCalledWith("{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n");
  });

  it("fails import when multipart file is missing", async () => {
    const response = createResponseDouble();
    const next = vi.fn<NextFunction>();
    const router = createChannelUserRouter(createChannelUserLogicDouble());

    await findHandler(router as Router, "post", "/api/dip-studio/v1/channel-users/import", 1)?.(
      { file: undefined } as unknown as Request,
      response,
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: "Multipart field `file` is required"
      })
    );
  });

  it("imports JSONL content", async () => {
    const response = createResponseDouble();
    const next = vi.fn<NextFunction>();
    const importChannelUsers = vi.fn().mockResolvedValue({ count: 1 });
    const router = createChannelUserRouter(createChannelUserLogicDouble({
      importChannelUsers,
    }));

    await findHandler(router as Router, "post", "/api/dip-studio/v1/channel-users/import", 1)?.(
      {
        file: {
          buffer: Buffer.from("{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n")
        }
      } as unknown as Request,
      response,
      next
    );

    expect(importChannelUsers).toHaveBeenCalledWith("{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n");
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({ count: 1 });
  });

  it("wraps unexpected import failures as 502", async () => {
    const response = createResponseDouble();
    const next = vi.fn<NextFunction>();
    const router = createChannelUserRouter(createChannelUserLogicDouble({
      importChannelUsers: vi.fn().mockRejectedValue(new Error("boom")),
    }));

    await findHandler(router as Router, "post", "/api/dip-studio/v1/channel-users/import", 1)?.(
      {
        file: {
          buffer: Buffer.from("{\"displayName\":\"Alice\",\"channel\":{\"type\":\"feishu\",\"user_id\":\"o-1\"}}\n")
        }
      } as unknown as Request,
      response,
      next
    );

    expect(next).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 502,
        message: "Failed to import channel users"
      })
    );
  });
});
