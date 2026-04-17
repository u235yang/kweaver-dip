import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { HttpError } from "../errors/http-error";
import {
  appendAttachmentHintsToMessage,
  attachDownstreamAbortHandlers,
  buildSessionLabelPrefix,
  buildFirstTurnSessionLabel,
  buildOpenClawSessionKey,
  createChatRouter,
  isChatAgentMessageInputItem,
  isFirstChatTurn,
  parseOptionalNonNegativeIntegerString,
  readAgentIdFromSessionKey,
  readChatAgentAttachments,
  readChatAgentItemText,
  readChatAgentMessage,
  readChatAgentRequestBody,
  readChatHistoryParams,
  readCreateSessionKeyRequestBody,
  readOptionalHeaderValue,
  readRequiredSessionKeyHeader,
  readRequiredUserIdHeader,
  resolveChatAgentSessionLabel,
  writeEventStreamHeaders
} from "./chat";

/**
 * Creates a minimal response double with chainable methods.
 *
 * @returns The mocked response object.
 */
function createResponseDouble(): Response {
  const response = {
    status: vi.fn(),
    json: vi.fn()
  } as unknown as Response;

  vi.mocked(response.status).mockReturnValue(response);

  return response;
}

/**
 * Reads one router layer by path and HTTP method.
 *
 * @param router The Express router double.
 * @param path The registered route path.
 * @param method The expected HTTP method.
 * @returns The matched router layer when found.
 */
function findRouteLayer(
  router: {
    stack: Array<{
      route?: {
        path: string;
        methods?: Record<string, boolean>;
        stack: Array<{
          handle: (
            request: Request,
            response: Response,
            next: NextFunction
          ) => Promise<void> | void;
        }>;
      };
    }>;
  },
  path: string,
  method: "get" | "post"
): {
  route?: {
    path: string;
    methods?: Record<string, boolean>;
    stack: Array<{
      handle: (
        request: Request,
        response: Response,
        next: NextFunction
      ) => Promise<void> | void;
    }>;
  };
} | undefined {
  return router.stack.find(
    (entry) => entry.route?.path === path && entry.route?.methods?.[method] === true
  );
}

describe("readChatHistoryParams", () => {
  it("parses session key header and optional limit", () => {
    expect(
      readChatHistoryParams(
        {
          "x-openclaw-session-key": "agent:demo:user:user-1:direct:chat-1"
        },
        {
          limit: "20"
        }
      )
    ).toEqual({
      sessionKey: "agent:demo:user:user-1:direct:chat-1",
      limit: 20
    });
  });

  it("rejects missing session key header", () => {
    expect(() => readChatHistoryParams({}, {})).toThrow(
      "x-openclaw-session-key header is required"
    );
  });

  it("validates session and integer helpers", () => {
    expect(readRequiredUserIdHeader([" user-1 ", "ignored"])).toBe("user-1");
    expect(() => readRequiredUserIdHeader(undefined)).toThrow(
      "x-user-id header is required"
    );
    expect(readRequiredSessionKeyHeader({
      "x-openclaw-session-key": ["agent:a:user:u:direct:c", "ignored"]
    })).toBe("agent:a:user:u:direct:c");
    expect(() => readRequiredSessionKeyHeader(undefined)).toThrow(
      "x-openclaw-session-key header is required"
    );
    expect(readOptionalHeaderValue(undefined)).toBeUndefined();
    expect(readOptionalHeaderValue(["x", "y"])).toBe("x");
    expect(readAgentIdFromSessionKey("agent:demo:user:user-1:direct:chat-1")).toBe("demo");
    expect(() => readAgentIdFromSessionKey("user:user-1:direct:chat-1")).toThrow(
      "x-openclaw-session-key must start with agent:<agentId>:"
    );
    expect(parseOptionalNonNegativeIntegerString(undefined, "limit")).toBeUndefined();
    expect(parseOptionalNonNegativeIntegerString("0", "limit")).toBe(0);
    expect(() => parseOptionalNonNegativeIntegerString("x", "limit")).toThrow(
      "Invalid query parameter `limit`"
    );
  });
});

describe("chat request helpers", () => {
  it("validates session creation body and session key builder", () => {
    expect(readCreateSessionKeyRequestBody({ agentId: " demo " })).toEqual({
      agentId: "demo"
    });
    expect(buildOpenClawSessionKey("agent-1", "user-1", "chat-1")).toBe(
      "agent:agent-1:user:user-1:direct:chat-1"
    );
    expect(() => readCreateSessionKeyRequestBody(null)).toThrow(
      "Session key request body must be a JSON object"
    );
    expect(() => readCreateSessionKeyRequestBody({ agentId: " " })).toThrow(
      "agentId is required"
    );
  });

  it("validates chat agent request body, messages, and attachments", () => {
    expect(
      readChatAgentRequestBody({
        input: [
          {
            type: "message",
            role: "user",
            content: [
              { type: "input_text", text: " Hel" },
              { type: "text", text: "lo " }
            ]
          }
        ],
        attachments: [
          {
            type: "input_file",
            source: { type: "path", path: " tmp/a.txt " }
          }
        ]
      })
    ).toEqual({
      message: "Hello",
      attachments: [
        {
          type: "input_file",
          source: { type: "path", path: "tmp/a.txt" }
        }
      ]
    });
    expect(readChatAgentMessage(" hello ")).toBe("hello");
    expect(readChatAgentItemText(" hello ")).toBe("hello");
    expect(readChatAgentItemText(1 as never)).toBe("");
    expect(readChatAgentItemText([{ type: "image" } as never])).toBe("");
    expect(isChatAgentMessageInputItem({ type: "message", role: "user", content: "x" })).toBe(true);
    expect(isChatAgentMessageInputItem({ type: "tool" })).toBe(false);
    expect(isChatAgentMessageInputItem(null)).toBe(false);
    expect(readChatAgentAttachments(undefined)).toBeUndefined();
    expect(appendAttachmentHintsToMessage("hello", undefined)).toBe("hello");

    expect(() => readChatAgentRequestBody([])).toThrow(
      "Chat agent request body must be a JSON object"
    );
    expect(() => readChatAgentMessage([])).toThrow(
      "Chat agent input must include a user message"
    );
    expect(() => readChatAgentMessage(1)).toThrow(
      "Chat agent input must be a non-empty string or a message item array"
    );
    expect(() => readChatAgentAttachments("x")).toThrow(
      "Chat agent attachments must be an array"
    );
    expect(() => readChatAgentAttachments([1])).toThrow(
      "Chat agent attachment must be an object"
    );
    expect(() => readChatAgentAttachments([{ type: "bad" }])).toThrow(
      "Chat agent attachment type only supports `input_file`"
    );
    expect(() => readChatAgentAttachments([{ type: "input_file", source: null }])).toThrow(
      "Chat agent attachment source must be an object"
    );
    expect(() =>
      readChatAgentAttachments([{ type: "input_file", source: { type: "url" } }])
    ).toThrow("Chat agent attachment source.type only supports `path`");
    expect(() =>
      readChatAgentAttachments([{ type: "input_file", source: { type: "path", path: " " } }])
    ).toThrow("Chat agent attachment source.path must be a non-empty string");
  });

  it("writes SSE headers and aborts upstream only on unexpected disconnects", () => {
    const response = {
      status: vi.fn(),
      setHeader: vi.fn(),
      flushHeaders: vi.fn(),
      on: vi.fn()
    } as unknown as Response;
    vi.mocked(response.status).mockReturnValue(response);

    const headers = new Headers({
      "content-type": "text/plain",
      "cache-control": "private",
      connection: "close"
    });

    writeEventStreamHeaders(response, 201, headers);

    expect(response.status).toHaveBeenCalledWith(201);
    expect(response.setHeader).toHaveBeenCalledWith("content-type", "text/plain");
    expect(response.setHeader).toHaveBeenCalledWith("cache-control", "private");
    expect(response.setHeader).toHaveBeenCalledWith("connection", "close");
    expect(response.setHeader).toHaveBeenCalledWith("x-accel-buffering", "no");
    expect(response.flushHeaders).toHaveBeenCalled();

    const request = { on: vi.fn() } as unknown as Request;
    const downstreamResponse = {
      on: vi.fn(),
      writableEnded: false
    } as unknown as Response;
    const abortController = new AbortController();
    const abortSpy = vi.spyOn(abortController, "abort");

    attachDownstreamAbortHandlers(request, downstreamResponse, abortController);

    const requestAborted = vi.mocked(request.on).mock.calls[0]?.[1] as () => void;
    const responseClosed = vi.mocked(downstreamResponse.on).mock.calls[0]?.[1] as () => void;

    requestAborted();
    responseClosed();

    expect(abortSpy).toHaveBeenCalledTimes(2);

    vi.mocked(downstreamResponse.on).mockClear();
    (downstreamResponse as { writableEnded: boolean }).writableEnded = true;
    attachDownstreamAbortHandlers(request, downstreamResponse, abortController);
    const closedWithoutAbort = vi.mocked(downstreamResponse.on).mock.calls[0]?.[1] as () => void;
    closedWithoutAbort();
    expect(abortSpy).toHaveBeenCalledTimes(2);
  });
});

describe("chat agent session labels", () => {
  it("builds the first-turn label using the required format", () => {
    expect(buildFirstTurnSessionLabel("  今天天气怎么样？ \n", "3f9c2b6a-xxxx")).toBe(
      "今天天气怎么样？_3f9c2b6a"
    );
  });

  it("uses whole sentences when truncating the first-turn label", () => {
    expect(
      buildFirstTurnSessionLabel(
        "这是第一句，包含一些额外说明。这是第二句，继续补充上下文。这是第三句，用来拉长首轮消息。这是第四句，这一句不会进入 label，因为总长度会超出上游限制。",
        "3f9c2b6a-xxxx"
      )
    ).toBe("这是第一句，包含一些额外说明。这是第二句，继续补充上下文。这是第三句，用来拉长首轮消息。_3f9c2b6a");
  });

  it("falls back to truncating the first sentence when it exceeds the limit", () => {
    expect(buildSessionLabelPrefix("a".repeat(80))).toBe("a".repeat(55));
  });

  it("treats a missing session as the first turn", async () => {
    await expect(
      isFirstChatTurn(
        {
          getChatMessages: vi.fn().mockRejectedValue(new HttpError(404, "not found")),
          getSession: vi.fn(),
          listSessions: vi.fn(),
          deleteSession: vi.fn(),
          getSessionSummary: vi.fn(),
          getSessionArchives: vi.fn(),
          getSessionArchiveSubpath: vi.fn(),
          previewSessions: vi.fn()
        },
        "agent:demo:user:user-1:direct:chat-1"
      )
    ).resolves.toBe(true);
  });

  it("returns a label only for the first chat turn", async () => {
    const sessionsLogic = {
      getChatMessages: vi.fn().mockResolvedValueOnce({
        sessionKey: "agent:demo:user:user-1:direct:chat-1",
        messages: []
      }).mockResolvedValueOnce({
        sessionKey: "agent:demo:user:user-1:direct:chat-1",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hello" }]
          }
        ]
      }),
      getSession: vi.fn(),
      listSessions: vi.fn(),
      deleteSession: vi.fn(),
      getSessionSummary: vi.fn(),
      getSessionArchives: vi.fn(),
      getSessionArchiveSubpath: vi.fn(),
      previewSessions: vi.fn()
    };

    await expect(
      resolveChatAgentSessionLabel(
        sessionsLogic,
        "agent:demo:user:user-1:direct:chat-1",
        "hello world"
      )
    ).resolves.toMatch(/^hello world_[0-9a-fA-F]{8}$/);

    await expect(
      resolveChatAgentSessionLabel(
        sessionsLogic,
        "agent:demo:user:user-1:direct:chat-1",
        "hello world"
      )
    ).resolves.toBeUndefined();
  });
});

describe("createChatRouter", () => {
  it("registers all chat routes", () => {
    const router = createChatRouter() as {
      stack: Array<{
        route?: {
          path: string;
        };
      }>;
    };

    expect(findRouteLayer(router, "/api/dip-studio/v1/chat/session", "post")).toBeDefined();
    expect(findRouteLayer(router, "/api/dip-studio/v1/chat/messages", "get")).toBeDefined();
    expect(findRouteLayer(router, "/api/dip-studio/v1/chat/agent", "post")).toBeDefined();
  });

  it("handles chat messages request", async () => {
    const getChatMessages = vi.fn().mockResolvedValue({
      sessionKey: "agent:demo:user:user-1:direct:chat-1",
      sessionId: "runtime-1",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              source: {
                type: "path",
                path: "tmp/chat-1/a.txt"
              }
            },
            {
              type: "text",
              text: "hello"
            }
          ]
        }
      ]
    });
    const router = createChatRouter({
      sessionsLogic: {
        getChatMessages,
        getSession: vi.fn(),
        listSessions: vi.fn(),
        deleteSession: vi.fn(),
        getSessionSummary: vi.fn(),
        getSessionArchives: vi.fn(),
        getSessionArchiveSubpath: vi.fn(),
        previewSessions: vi.fn()
      }
    }) as {
      stack: Array<{
        route?: {
          path: string;
          stack: Array<{
            handle: (
              request: Request,
              response: Response,
              next: NextFunction
            ) => Promise<void>;
          }>;
        };
      }>;
    };
    const layer = findRouteLayer(router, "/api/dip-studio/v1/chat/messages", "get");
    const handler = layer?.route?.stack[0]?.handle;
    const response = createResponseDouble();
    const next = vi.fn<NextFunction>();

    await handler?.(
      {
        headers: {
          "x-openclaw-session-key": "agent:demo:user:user-1:direct:chat-1"
        },
        query: {
          limit: "50"
        }
      } as unknown as Request,
      response,
      next
    );

    expect(getChatMessages).toHaveBeenCalledWith({
      sessionKey: "agent:demo:user:user-1:direct:chat-1",
      limit: 50
    });
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith({
      sessionKey: "agent:demo:user:user-1:direct:chat-1",
      sessionId: "runtime-1",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "input_file",
              source: {
                type: "path",
                path: "tmp/chat-1/a.txt"
              }
            },
            {
              type: "text",
              text: "hello"
            }
          ]
        }
      ]
    });
    expect(next).not.toHaveBeenCalled();
  });
});
