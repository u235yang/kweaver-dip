import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { OpenClawAgentsAdapter } from "../adapters/openclaw-agents-adapter";
import { HttpError } from "../errors/http-error";
import { normalizeOpenClawAccountIdFromAppId, resolveOpenClawConfigPath } from "./digital-human";
import type {
  ChannelUser,
  ChannelUserExportResult,
  ChannelUserImportError,
  ChannelUserImportResult,
  ChannelUserListItem,
  ChannelUserListQuery,
  ChannelUserListResponse,
  ChannelUserType,
  DigitalHumanChannelUsersResponse,
  UpdateDigitalHumanChannelUsersRequest,
  UpsertChannelUserRequest
} from "../types/channel-user";

const DEFAULT_PAGE_START = 0;
const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;

/**
 * Application logic used to manage persisted channel users and digital-human message scopes.
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
   * Reads the channel users available to one digital human.
   *
   * @param digitalHumanId Target digital human identifier.
   * @param query List filters.
   * @returns The paged channel user response.
   */
  listDigitalHumanChannelUsers(
    digitalHumanId: string,
    query: ChannelUserListQuery
  ): Promise<ChannelUserListResponse>;

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

  /**
   * Updates the selected whitelist for one digital human.
   *
   * @param digitalHumanId Target digital human identifier.
   * @param request Selected channel users.
   * @returns The persisted whitelist payload.
   */
  updateDigitalHumanChannelUsers(
    digitalHumanId: string,
    request: UpdateDigitalHumanChannelUsersRequest
  ): Promise<DigitalHumanChannelUsersResponse>;
}

/**
 * Options required to construct {@link DefaultChannelUserLogic}.
 */
export interface ChannelUserLogicOptions {
  /**
   * OpenClaw gateway adapter used for `config.get` / `config.patch`.
   */
  openClawAgentsAdapter: OpenClawAgentsAdapter;

  /**
   * Clock used to build export filenames.
   */
  now?: () => Date;
}

/**
 * Default channel user management implementation backed by `channel-users.jsonl`.
 */
export class DefaultChannelUserLogic implements ChannelUserLogic {
  private readonly openClawAgentsAdapter: OpenClawAgentsAdapter;
  private readonly now: () => Date;

  /**
   * Creates the logic instance.
   *
   * @param options Dependencies and configuration.
   */
  public constructor(options: ChannelUserLogicOptions) {
    this.openClawAgentsAdapter = options.openClawAgentsAdapter;
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
  public async listDigitalHumanChannelUsers(
    digitalHumanId: string,
    query: ChannelUserListQuery
  ): Promise<ChannelUserListResponse> {
    const scope = await readDigitalHumanChannelScope(digitalHumanId);
    const users = sortChannelUsers(await readChannelUsersFile()).filter((user) => {
      if (user.channel.type !== scope.channelType) {
        return false;
      }
      if (scope.allowFrom === "*") {
        return true;
      }
      return scope.allowFrom.has(user.channel.user_id);
    });

    return buildChannelUserListResponse(users, query);
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

    if (current.channel.user_id !== updated.channel.user_id || current.channel.type !== updated.channel.type) {
      await rewriteOpenClawConfig(async (config) => {
        replaceAllowFromValue(config, current.channel.type, current.channel.user_id, updated.channel.user_id);
      }, this.openClawAgentsAdapter);
    }

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

    const [removed] = users.splice(index, 1);
    await writeChannelUsersFile(sortChannelUsers(users));

    await rewriteOpenClawConfig(async (config) => {
      removeAllowFromValue(config, removed.channel.type, removed.channel.user_id);
    }, this.openClawAgentsAdapter);
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
    await rewriteOpenClawConfig(async (config) => {
      pruneAllowFromValues(config, new Map([
        ["feishu", new Set(sorted.filter((user) => user.channel.type === "feishu").map((user) => user.channel.user_id))],
        ["dingding", new Set(sorted.filter((user) => user.channel.type === "dingding").map((user) => user.channel.user_id))]
      ]));
    }, this.openClawAgentsAdapter);

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

  /**
   * @inheritdoc
   */
  public async updateDigitalHumanChannelUsers(
    digitalHumanId: string,
    request: UpdateDigitalHumanChannelUsersRequest
  ): Promise<DigitalHumanChannelUsersResponse> {
    const channelUsers = await readChannelUsersFile();
    const scope = await readDigitalHumanChannelScope(digitalHumanId);
    const allowFrom = dedupeStrings(request.allowFrom);
    const selectedUsers = allowFrom.map((userId) => {
      const user = channelUsers.find((item) => item.channel.user_id === userId);
      if (user === undefined) {
        throw new HttpError(400, `Channel user id not found: ${userId}`);
      }
      if (user.channel.type !== scope.channelType) {
        throw new HttpError(
          400,
          `Channel user id ${userId} does not belong to digital human channel ${scope.channelType}`
        );
      }
      return user;
    });

    await rewriteOpenClawConfig(async (config) => {
      setDigitalHumanAllowFrom(config, digitalHumanId, scope.channelKey, scope.accountId, allowFrom);
    }, this.openClawAgentsAdapter);

    return {
      digitalHumanId,
      channelType: scope.channelType,
      allowFrom
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
 * Reads one digital human's bound channel and whitelist state.
 *
 * @param digitalHumanId Target digital human identifier.
 * @returns Bound channel type, OpenClaw channel key, account id and whitelist.
 */
async function readDigitalHumanChannelScope(
  digitalHumanId: string
): Promise<{
  channelType: ChannelUserType;
  channelKey: "feishu" | "dingtalk";
  accountId: string;
  allowFrom: Set<string> | "*";
}> {
  const config = await readOpenClawConfig();
  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  const binding = bindings.find((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return record.agentId === digitalHumanId;
  });

  if (binding === undefined) {
    throw new HttpError(404, `Digital human channel binding not found: ${digitalHumanId}`);
  }

  const match = (binding as Record<string, unknown>).match;
  if (typeof match !== "object" || match === null) {
    throw new HttpError(404, `Digital human channel binding not found: ${digitalHumanId}`);
  }

  const rawChannel = (match as Record<string, unknown>).channel;
  if (rawChannel !== "feishu" && rawChannel !== "dingtalk") {
    throw new HttpError(404, `Digital human channel binding not found: ${digitalHumanId}`);
  }
  const channelKey = rawChannel;
  const channelType: ChannelUserType = channelKey === "dingtalk" ? "dingding" : "feishu";
  const rawAccountId = (match as Record<string, unknown>).accountId;
  const accountId = normalizeOpenClawAccountIdFromAppId(
    typeof rawAccountId === "string" ? rawAccountId : ""
  );

  const account = readChannelAccount(config, channelKey, accountId);
  const allowFromRaw = account.allowFrom;
  if (Array.isArray(allowFromRaw) && allowFromRaw.some((item) => item === "*")) {
    return {
      channelType,
      channelKey,
      accountId,
      allowFrom: "*"
    };
  }

  const allowFrom = new Set(
    Array.isArray(allowFromRaw)
      ? allowFromRaw.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      : []
  );

  return {
    channelType,
    channelKey,
    accountId,
    allowFrom
  };
}

/**
 * Reads the local OpenClaw config file.
 *
 * @returns Parsed config object.
 */
async function readOpenClawConfig(): Promise<Record<string, unknown>> {
  const configPath = resolveOpenClawConfigPath();
  try {
    const raw = await readFile(configPath, "utf-8");
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * Applies an OpenClaw config mutation and persists it through `config.patch`, falling back
 * to the local file when the gateway rejects the patch.
 *
 * @param mutate Mutation callback.
 * @param openClawAgentsAdapter Gateway adapter.
 */
async function rewriteOpenClawConfig(
  mutate: (config: Record<string, unknown>) => Promise<void> | void,
  openClawAgentsAdapter: OpenClawAgentsAdapter
): Promise<void> {
  const configPath = resolveOpenClawConfigPath();
  let baseConfig = await readOpenClawConfig();
  await mutate(baseConfig);

  try {
    const current = await openClawAgentsAdapter.getConfig();
    const parsed = safeParseObject(current.raw);
    if (parsed !== undefined) {
      baseConfig = parsed;
      await mutate(baseConfig);
    }

    await openClawAgentsAdapter.patchConfig({
      raw: JSON.stringify(baseConfig),
      baseHash: current.hash
    });
    return;
  } catch {
    await writeFile(configPath, `${JSON.stringify(baseConfig, null, 2)}\n`, "utf-8");
  }
}

/**
 * Reads one account object from the config root.
 *
 * @param config Parsed config root.
 * @param channelKey OpenClaw channel key.
 * @param accountId Normalized OpenClaw account id.
 * @returns Mutable account object.
 */
function readChannelAccount(
  config: Record<string, unknown>,
  channelKey: "feishu" | "dingtalk",
  accountId: string
): Record<string, unknown> {
  const channels = typeof config.channels === "object" && config.channels !== null
    ? config.channels as Record<string, unknown>
    : {};
  const channelBlock = typeof channels[channelKey] === "object" && channels[channelKey] !== null
    ? channels[channelKey] as Record<string, unknown>
    : {};
  const accounts = typeof channelBlock.accounts === "object" && channelBlock.accounts !== null
    ? channelBlock.accounts as Record<string, unknown>
    : {};
  const account = typeof accounts[accountId] === "object" && accounts[accountId] !== null
    ? accounts[accountId] as Record<string, unknown>
    : undefined;

  if (account === undefined) {
    throw new HttpError(404, `Digital human channel account not found: ${channelKey}/${accountId}`);
  }

  return account;
}

/**
 * Sets the exact `allowFrom` list for one digital human binding.
 *
 * @param config Parsed config root.
 * @param digitalHumanId Target digital human identifier.
 * @param channelKey OpenClaw channel key.
 * @param accountId Normalized account id.
 * @param allowFrom User ID whitelist to persist.
 */
function setDigitalHumanAllowFrom(
  config: Record<string, unknown>,
  digitalHumanId: string,
  channelKey: "feishu" | "dingtalk",
  accountId: string,
  allowFrom: string[]
): void {
  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  const hasBinding = bindings.some((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }
    const record = entry as Record<string, unknown>;
    if (record.agentId !== digitalHumanId) {
      return false;
    }
    const match = typeof record.match === "object" && record.match !== null
      ? record.match as Record<string, unknown>
      : undefined;
    if (match === undefined) {
      return false;
    }
    return match.channel === channelKey
      && normalizeOpenClawAccountIdFromAppId(typeof match.accountId === "string" ? match.accountId : "") === accountId;
  });

  if (!hasBinding) {
    throw new HttpError(404, `Digital human channel binding not found: ${digitalHumanId}`);
  }

  const channels = typeof config.channels === "object" && config.channels !== null
    ? config.channels as Record<string, unknown>
    : {};
  const channelBlock = typeof channels[channelKey] === "object" && channels[channelKey] !== null
    ? channels[channelKey] as Record<string, unknown>
    : {};
  const accounts = typeof channelBlock.accounts === "object" && channelBlock.accounts !== null
    ? channelBlock.accounts as Record<string, unknown>
    : {};
  const account = typeof accounts[accountId] === "object" && accounts[accountId] !== null
    ? accounts[accountId] as Record<string, unknown>
    : {};

  accounts[accountId] = {
    ...account,
    allowFrom
  };
  channels[channelKey] = {
    ...channelBlock,
    accounts
  };
  config.channels = channels;
}

/**
 * Removes one User ID from all matching `allowFrom` arrays.
 *
 * @param config Parsed config root.
 * @param channelType Channel user type.
 * @param userId Removed User ID.
 */
function removeAllowFromValue(
  config: Record<string, unknown>,
  channelType: ChannelUserType,
  userId: string
): void {
  mutateAccountsForChannel(config, channelType, (account) => {
    if (!Array.isArray(account.allowFrom)) {
      return;
    }
    account.allowFrom = account.allowFrom.filter((item) => item !== userId);
  });
}

/**
 * Replaces one User ID in `allowFrom` arrays when a channel user changes.
 *
 * @param config Parsed config root.
 * @param channelType Channel user type.
 * @param from Previous User ID.
 * @param to Replacement User ID.
 */
function replaceAllowFromValue(
  config: Record<string, unknown>,
  channelType: ChannelUserType,
  from: string,
  to: string
): void {
  mutateAccountsForChannel(config, channelType, (account) => {
    if (!Array.isArray(account.allowFrom)) {
      return;
    }
    account.allowFrom = dedupeStrings(
      account.allowFrom.map((item) => item === from ? to : item).filter(isNonEmptyString)
    );
  });
}

/**
 * Removes stale User IDs from all channel account whitelists.
 *
 * @param config Parsed config root.
 * @param userIdsByChannel Valid User ID sets grouped by channel user type.
 */
function pruneAllowFromValues(
  config: Record<string, unknown>,
  userIdsByChannel: Map<ChannelUserType, Set<string>>
): void {
  mutateAccountsForChannel(config, "feishu", (account) => {
    pruneAccountAllowFrom(account, userIdsByChannel.get("feishu") ?? new Set<string>());
  });
  mutateAccountsForChannel(config, "dingding", (account) => {
    pruneAccountAllowFrom(account, userIdsByChannel.get("dingding") ?? new Set<string>());
  });
}

/**
 * Prunes one account allowFrom list against valid User IDs.
 *
 * @param account Mutable account object.
 * @param validUserIds Valid User IDs for this channel.
 */
function pruneAccountAllowFrom(account: Record<string, unknown>, validUserIds: Set<string>): void {
  if (!Array.isArray(account.allowFrom) || account.allowFrom.some((item) => item === "*")) {
    return;
  }
  account.allowFrom = account.allowFrom.filter(
    (item): item is string => typeof item === "string" && validUserIds.has(item)
  );
}

/**
 * Mutates every account block under one channel type.
 *
 * @param config Parsed config root.
 * @param channelType Channel user type.
 * @param mutate Account mutation callback.
 */
function mutateAccountsForChannel(
  config: Record<string, unknown>,
  channelType: ChannelUserType,
  mutate: (account: Record<string, unknown>) => void
): void {
  const channelKey = channelType === "dingding" ? "dingtalk" : "feishu";
  const channels = typeof config.channels === "object" && config.channels !== null
    ? config.channels as Record<string, unknown>
    : {};
  const channelBlock = typeof channels[channelKey] === "object" && channels[channelKey] !== null
    ? channels[channelKey] as Record<string, unknown>
    : undefined;
  if (channelBlock === undefined) {
    return;
  }
  const accounts = typeof channelBlock.accounts === "object" && channelBlock.accounts !== null
    ? channelBlock.accounts as Record<string, unknown>
    : undefined;
  if (accounts === undefined) {
    return;
  }

  for (const [accountId, value] of Object.entries(accounts)) {
    if (typeof value !== "object" || value === null) {
      continue;
    }
    const account = value as Record<string, unknown>;
    mutate(account);
    accounts[accountId] = account;
  }

  channelBlock.accounts = accounts;
  channels[channelKey] = channelBlock;
  config.channels = channels;
}

/**
 * Safely parses a JSON object string.
 *
 * @param raw Raw JSON text.
 * @returns Parsed object, when valid.
 */
function safeParseObject(raw: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return undefined;
  }
  return undefined;
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

/**
 * Deduplicates a string array while preserving first occurrence order.
 *
 * @param values Candidate strings.
 * @returns Deduplicated strings.
 */
function dedupeStrings(values: string[]): string[] {
  return Array.from(new Set(values.filter(isNonEmptyString)));
}

/**
 * Narrows one unknown value to a non-empty string.
 *
 * @param value Candidate unknown value.
 * @returns Whether the value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}
