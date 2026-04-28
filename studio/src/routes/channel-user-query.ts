import type { Request } from "express";

import { HttpError } from "../errors/http-error";
import type {
  ChannelUserListQuery,
  ChannelUserType
} from "../types/channel-user";

/**
 * Parses and validates the channel-user list query parameters.
 *
 * @param query Raw Express query object.
 * @returns The normalized list query.
 */
export function readChannelUserListQuery(query: Request["query"]): ChannelUserListQuery {
  const rawQuery = typeof query === "object" && query !== null
    ? query as Record<string, unknown>
    : {};
  const type = readOptionalChannelUserType(rawQuery.type);
  const displayName = readOptionalTrimmedString(rawQuery.displayName);
  const start = readOptionalNumber(rawQuery.start, "start");
  const limit = readOptionalNumber(rawQuery.limit, "limit");

  return {
    ...(type !== undefined ? { type } : {}),
    ...(displayName !== undefined ? { displayName } : {}),
    ...(start !== undefined ? { start } : {}),
    ...(limit !== undefined ? { limit } : {})
  };
}

/**
 * Reads one optional trimmed string from query parameters.
 *
 * @param value Raw query value.
 * @returns Trimmed string, when present.
 */
function readOptionalTrimmedString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/**
 * Reads one optional channel user type.
 *
 * @param value Raw field value.
 * @returns Validated channel user type, when present.
 */
function readOptionalChannelUserType(value: unknown): ChannelUserType | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (value === "feishu" || value === "dingding") {
    return value;
  }
  throw new HttpError(400, 'type must be "feishu" or "dingding"');
}

/**
 * Reads one optional non-negative integer query parameter.
 *
 * @param value Raw query value.
 * @param key Field key.
 * @returns Parsed integer, when present.
 */
function readOptionalNumber(value: unknown, key: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpError(400, `${key} must be an integer`);
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || `${parsed}` !== value.trim()) {
    throw new HttpError(400, `${key} must be an integer`);
  }
  return parsed;
}
