import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import { HttpError } from "../errors/http-error";
import type {
  ChannelUser,
  ChannelUserExportResult,
  ChannelUserImportError,
  ChannelUserImportResult,
  ChannelUserListItem,
  ChannelUserListQuery,
  ChannelUserListResponse,
  ChannelUserType,
  UpsertChannelUserRequest
} from "../types/channel-user";

const DEFAULT_PAGE_START = 0;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/**
 * Application logic used to manage persisted channel users.
 */
export interface ChannelUserLogic {
  /**
   * Reads the channel user list with optional filtering and pagination.
   *
   * @param query List filters.
   * @returns The paged channel user response.
   */
  listChannelUsers(query: ChannelUserListQuery): Promise<ChannelUserListResponse>;

  /**
   * Replaces the channel user JSONL file with uploaded content after validation.
   *
   * @param content Uploaded JSONL content.
   * @returns The import summary.
   */
  importChannelUsers(content: string): Promise<ChannelUserImportResult>;

  /**
   * Exports the current channel user file as JSONL.
   *
   * @returns Filename and serialized content.
   */
  exportChannelUsers(): Promise<ChannelUserExportResult>;
}

/**
 * Options required to construct {@link DefaultChannelUserLogic}.
 */
export interface ChannelUserLogicOptions {
  /**
   * Clock used to build export filenames.
   */
  now?: () => Date;
}

/**
 * Default channel user management implementation backed by `channel-users.jsonl`.
 */
export class DefaultChannelUserLogic implements ChannelUserLogic {
  private readonly now: () => Date;

  /**
   * Creates the logic instance.
   *
   * @param options Dependencies and configuration.
   */
  public constructor(options: ChannelUserLogicOptions = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * @inheritdoc
   */
  public async listChannelUsers(query: ChannelUserListQuery): Promise<ChannelUserListResponse> {
    return buildChannelUserListResponse(sortChannelUsers(await readChannelUsersFile()), query);
  }

  /**
   * @inheritdoc
   */
  public async createChannelUser(input: UpsertChannelUserRequest): Promise<ChannelUser> {
    const users = await readChannelUsersFile();
    assertChannelUserUniqueness(users, input);

    const created = toChannelUserApi({
      displayName: input.displayName.trim(),
      channel: {
        type: input.channel.type,
        user_id: input.channel.user_id.trim()
      }
    });

    users.push(created);
    await writeChannelUsersFile(sortChannelUsers(users));
    return created;
  }

  /**
   * @inheritdoc
   */
  public async updateChannelUser(id: string, input: UpsertChannelUserRequest): Promise<ChannelUser> {
    const users = await readChannelUsersFile();
    const index = users.findIndex((user) => deriveChannelUserId(user.channel.type, user.channel.user_id) === id);
    if (index < 0) {
      throw new HttpError(404, `Channel user not found: ${id}`);
    }

    assertChannelUserUniqueness(users, input, id);

    const current = users[index];
    const updated = toChannelUserApi({
      displayName: input.displayName.trim(),
      channel: {
        type: input.channel.type,
        user_id: input.channel.user_id.trim()
      }
    });

    users[index] = updated;
    await writeChannelUsersFile(sortChannelUsers(users));

    return updated;
  }

  /**
   * @inheritdoc
   */
  public async deleteChannelUser(id: string): Promise<void> {
    const users = await readChannelUsersFile();
    const index = users.findIndex((user) => deriveChannelUserId(user.channel.type, user.channel.user_id) === id);
    if (index < 0) {
      throw new HttpError(404, `Channel user not found: ${id}`);
    }

    users.splice(index, 1);
    await writeChannelUsersFile(sortChannelUsers(users));
  }
  /**
   * @inheritdoc
   */
  public async importChannelUsers(content: string): Promise<ChannelUserImportResult> {
    const { users, errors } = parseChannelUsersJsonl(content);
    if (errors.length > 0) {
      throw new HttpError(
        400,
        "Invalid channel user JSONL import file",
        "DipStudio.InvalidParameter",
        { errors }
      );
    }

    const sorted = sortChannelUsers(users);
    await writeChannelUsersFile(sorted);

    return { count: sorted.length };
  }

  /**
   * @inheritdoc
   */
  public async exportChannelUsers(): Promise<ChannelUserExportResult> {
    const filename = buildExportFilename(this.now());
    const content = await readChannelUsersFileContent();

    return {
      filename,
      content
    };
  }

}

/**
 * Reads and validates the persisted channel user file.
 *
 * @returns All persisted channel users.
 */
export async function readChannelUsersFile(): Promise<ChannelUser[]> {
  const filePath = resolveChannelUsersFilePath();
  try {
    const raw = await readFile(filePath, "utf-8");
    const { users, errors } = parseChannelUsersJsonl(raw);
    if (errors.length > 0) {
      throw new HttpError(500, "Persisted channel user file is invalid");
    }
    return users.map(toChannelUserApi);
  } catch (error) {
    if (error instanceof HttpError) {
      throw error;
    }
    return [];
  }
}

/**
 * Writes all channel users back to the JSONL file.
 *
 * @param users Channel users to persist.
 */
export async function writeChannelUsersFile(users: ChannelUser[]): Promise<void> {
  const filePath = resolveChannelUsersFilePath();
  await mkdir(join(homedir(), ".openclaw", "workspace"), { recursive: true });
  const content = `${users.map((user) => JSON.stringify(toChannelUserRecord(user))).join("\n")}${users.length > 0 ? "\n" : ""}`;
  await writeFile(filePath, content, "utf-8");
}

/**
 * Reads the raw persisted JSONL file content without any transformation.
 *
 * @returns Raw channel-user JSONL content, or an empty string when the file is missing.
 */
async function readChannelUsersFileContent(): Promise<string> {
  const filePath = resolveChannelUsersFilePath();
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return "";
  }
}

/**
 * Parses and validates uploaded channel user JSONL content.
 *
 * @param content Uploaded JSONL text.
 * @returns Parsed users and validation errors.
 */
export function parseChannelUsersJsonl(
  content: string
): { users: ChannelUser[]; errors: ChannelUserImportError[] } {
  const users: ChannelUser[] = [];
  const errors: ChannelUserImportError[] = [];
  const seenUserIds = new Map<string, number>();
  const seenDisplayChannel = new Map<string, number>();

  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const raw = lines[index];
    const line = index + 1;
    if (raw.trim().length === 0) {
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      errors.push({ line, raw, reason: "JSON 解析失败" });
      continue;
    }

    const result = normalizeParsedChannelUser(parsed);
    if ("reason" in result) {
      errors.push({ line, raw, reason: result.reason });
      continue;
    }

    const duplicateReason = resolveDuplicateReason(
      result.user,
      seenUserIds,
      seenDisplayChannel,
      line
    );
    if (duplicateReason !== undefined) {
      errors.push({ line, raw, reason: duplicateReason });
      continue;
    }

    users.push(result.user);
  }

  return { users, errors };
}

/**
 * Resolves the persisted `channel-users.jsonl` location.
 *
 * @returns Absolute file path.
 */
export function resolveChannelUsersFilePath(): string {
  return join(homedir(), ".openclaw", "workspace", "channel-users.jsonl");
}

/**
 * Builds the exported JSONL filename.
 *
 * @param now Timestamp source.
 * @returns Download filename.
 */
export function buildExportFilename(now: Date): string {
  const parts = [
    now.getFullYear().toString().padStart(4, "0"),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
    now.getHours().toString().padStart(2, "0"),
    now.getMinutes().toString().padStart(2, "0"),
    now.getSeconds().toString().padStart(2, "0")
  ];

  return `通道用户_${parts[0]}_${parts[1]}_${parts[2]}_${parts[3]}_${parts[4]}_${parts[5]}.jsonl`;
}

/**
 * Sorts channel users by display name, then channel type, then id.
 *
 * @param users Raw channel users.
 * @returns Sorted copy.
 */
function sortChannelUsers(users: ChannelUser[]): ChannelUser[] {
  return [...users].sort((left, right) => {
    const display = left.displayName.localeCompare(right.displayName, "zh-Hans-CN");
    if (display !== 0) {
      return display;
    }
    const channel = left.channel.type.localeCompare(right.channel.type);
    if (channel !== 0) {
      return channel;
    }
    return left.channel.user_id.localeCompare(right.channel.user_id);
  });
}

/**
 * Applies list filters and pagination to channel users.
 *
 * @param users Sorted channel users.
 * @param query List filters.
 * @returns The paged channel user response.
 */
function buildChannelUserListResponse(
  users: ChannelUser[],
  query: ChannelUserListQuery
): ChannelUserListResponse {
  const start = normalizePageStart(query.start);
  const limit = normalizePageLimit(query.limit);
  let filteredUsers = users;

  if (query.type !== undefined) {
    filteredUsers = filteredUsers.filter((user) => user.channel.type === query.type);
  }

  if (query.displayName !== undefined) {
    const displayName = query.displayName.toLocaleLowerCase();
    filteredUsers = filteredUsers.filter((user) => user.displayName.toLocaleLowerCase().includes(displayName));
  }

  return {
    items: filteredUsers.slice(start, start + limit).map(toChannelUserListItem),
    total: filteredUsers.length,
    start,
    limit
  };
}

/**
 * Ensures manual create / update requests keep the uniqueness guarantees.
 *
 * @param users Existing persisted records.
 * @param input Candidate record.
 * @param excludeId Optional record id excluded from duplicate checks during update.
 */
function assertChannelUserUniqueness(
  users: ChannelUser[],
  input: UpsertChannelUserRequest,
  excludeId?: string
): void {
  const displayName = input.displayName.trim();
  const userId = input.channel.user_id.trim();
  const key = `${input.channel.type}::${displayName}`;

  if (users.some(
    (user) =>
      deriveChannelUserId(user.channel.type, user.channel.user_id) !== excludeId
      && user.channel.user_id === userId
  )) {
    throw new HttpError(409, `Channel user_id already exists: ${userId}`);
  }

  if (users.some(
    (user) =>
      deriveChannelUserId(user.channel.type, user.channel.user_id) !== excludeId
      && `${user.channel.type}::${user.displayName}` === key
  )) {
    throw new HttpError(409, `Channel user already exists: ${displayName} + ${input.channel.type}`);
  }
}

/**
 * Normalizes one parsed JSON value into a channel user.
 *
 * @param value One parsed JSON line.
 * @returns The normalized user, or one validation failure reason.
 */
function normalizeParsedChannelUser(
  value: unknown
): { user: ChannelUser } | { reason: string } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { reason: "记录必须是 JSON 对象" };
  }

  const raw = value as Record<string, unknown>;
  const displayName = typeof raw.displayName === "string" ? raw.displayName.trim() : "";
  if ("id" in raw) {
    return { reason: "字段 id 不允许出现" };
  }
  if (displayName.length === 0) {
    return { reason: "缺少字段 displayName" };
  }
  if (typeof raw.channel !== "object" || raw.channel === null || Array.isArray(raw.channel)) {
    return { reason: "缺少字段 channel" };
  }

  const channel = raw.channel as Record<string, unknown>;
  const type = channel.type;
  const userId = typeof channel.user_id === "string" ? channel.user_id.trim() : "";
  if (type !== "feishu" && type !== "dingding") {
    return { reason: "channel.type 必须为 feishu 或 dingding" };
  }
  if (userId.length === 0) {
    return { reason: "缺少字段 channel.user_id" };
  }

  return {
    user: {
      id: deriveChannelUserId(type, userId),
      displayName,
      channel: {
        type,
        user_id: userId
      }
    }
  };
}

/**
 * Detects duplicate JSONL rows according to the uniqueness constraints.
 *
 * @param user Candidate parsed channel user.
 * @param seenUserIds Seen user IDs map.
 * @param seenDisplayChannel Seen displayName + type combinations map.
 * @param line Current line number.
 * @returns Duplicate error reason, if any.
 */
function resolveDuplicateReason(
  user: ChannelUser,
  seenUserIds: Map<string, number>,
  seenDisplayChannel: Map<string, number>,
  line: number
): string | undefined {
  const displayKey = `${user.channel.type}::${user.displayName}`;
  if (seenUserIds.has(user.channel.user_id)) {
    return "与前面记录重复：channel.user_id 已存在";
  }

  if (seenDisplayChannel.has(displayKey)) {
    return "与前面记录重复：displayName + channel.type 组合已存在";
  }

  seenUserIds.set(user.channel.user_id, line);
  seenDisplayChannel.set(displayKey, line);
  return undefined;
}

/**
 * Derives the stable API id for one channel user.
 *
 * @param type Channel type.
 * @param userId Channel User ID.
 * @returns API identifier.
 */
export function deriveChannelUserId(type: ChannelUserType, userId: string): string {
  return `${type}:${encodeURIComponent(userId)}`;
}

/**
 * Converts one JSONL record to the API shape with a derived id.
 *
 * @param record JSONL record without persisted id.
 * @returns API payload with derived id.
 */
function toChannelUserApi(record: Omit<ChannelUser, "id"> | ChannelUser): ChannelUser {
  return {
    id: deriveChannelUserId(record.channel.type, record.channel.user_id),
    displayName: record.displayName,
    channel: {
      type: record.channel.type,
      user_id: record.channel.user_id
    }
  };
}

/**
 * Removes the derived API id so records can be persisted back to JSONL.
 *
 * @param user API payload.
 * @returns JSONL record.
 */
function toChannelUserRecord(user: ChannelUser): Omit<ChannelUser, "id"> {
  return {
    displayName: user.displayName,
    channel: {
      type: user.channel.type,
      user_id: user.channel.user_id
    }
  };
}

/**
 * Removes the derived id field for the list API response.
 *
 * @param user API payload with derived id.
 * @returns List item without id.
 */
function toChannelUserListItem(user: ChannelUser): ChannelUserListItem {
  return {
    displayName: user.displayName,
    channel: {
      type: user.channel.type,
      user_id: user.channel.user_id
    }
  };
}

/**
 * Normalizes the list pagination start parameter.
 *
 * @param start Raw start value.
 * @returns Safe start value.
 */
function normalizePageStart(start: number | undefined): number {
  if (start === undefined || Number.isNaN(start) || start < 0) {
    return DEFAULT_PAGE_START;
  }
  return Math.floor(start);
}

/**
 * Normalizes the list pagination limit parameter.
 *
 * @param limit Raw limit value.
 * @returns Safe limit value.
 */
function normalizePageLimit(limit: number | undefined): number {
  if (limit === undefined || Number.isNaN(limit) || limit <= 0) {
    return DEFAULT_PAGE_LIMIT;
  }
  return Math.min(MAX_PAGE_LIMIT, Math.floor(limit));
}
