import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import type { DigitalEmployeeTokenAdapter } from "../adapters/digital-employee-token-adapter";
import type { OpenClawAgentsAdapter } from "../adapters/openclaw-agents-adapter";
import type { OpenClawCronAdapter } from "../adapters/openclaw-cron-adapter";
import { HttpError } from "../errors/http-error";
import type {
  ChannelConfig,
  CreateDigitalHumanRequest,
  CreateDigitalHumanResult,
  DigitalHumanChannelType,
  DigitalHumanDetail,
  DigitalHumanList,
  DigitalHumanTemplate,
  UpdateDigitalHumanRequest,
  UpdateDigitalHumanResult
} from "../types/digital-human";
import type { OpenClawConfigGetResult } from "../types/openclaw";
import type { OpenClawCronJob } from "../types/plan";
import { normalizeCreateDigitalHumanSkills } from "../utils/skills";
import { resolveOpenClawWorkspacePath } from "../utils/workspace-secret";
import type { AgentSkillsLogic } from "./agent-skills";
import {
  buildTemplate,
  mergeFilesToTemplate,
  mergeTemplatePatch,
  renderIdentityMarkdown,
  renderSoulMarkdown,
  renderToolsMarkdown
} from "./digital-human-template";

const HIDDEN_DIGITAL_HUMAN_IDS = new Set(["main", "__internal_skill_agent__"]);
const DIGITAL_HUMAN_CRON_SCAN_LIMIT = 200;

/**
 * Application logic used to manage digital humans.
 */
export interface DigitalHumanLogic {
  /**
   * Fetches the public digital human list.
   *
   * @returns The normalized digital human list.
   */
  listDigitalHumans(): Promise<DigitalHumanList>;

  /**
   * Retrieves the detail view for a single digital human: fields parsed
   * from IDENTITY.md and SOUL.md, configured skills, and Feishu channel (when bound).
   *
   * @param id The digital human identifier.
   * @returns The detail payload (flat fields, no nested template).
   */
  getDigitalHuman(id: string): Promise<DigitalHumanDetail>;

  /**
   * Creates a new digital human with the full setup flow:
   * agent creation, template files via OpenClaw file RPCs, skill bindings, and channel binding.
   *
   * @param request The creation request payload.
   * @returns The created digital human summary including the rendered template.
   */
  createDigitalHuman(request: CreateDigitalHumanRequest): Promise<CreateDigitalHumanResult>;

  /**
   * Deletes an existing digital human.
   *
   * @param id The digital human identifier.
   * @param deleteFiles Whether to remove workspace files. Defaults to `false` to keep session history.
   */
  deleteDigitalHuman(id: string, deleteFiles?: boolean): Promise<void>;

  /**
   * Partially updates an existing digital human (IDENTITY.md, SOUL.md, skills, channel).
   *
   * @param id The digital human identifier.
   * @param patch Fields to merge; omitted fields are left unchanged.
   */
  updateDigitalHuman(
    id: string,
    patch: UpdateDigitalHumanRequest
  ): Promise<UpdateDigitalHumanResult>;
}

/**
 * Options required to construct {@link DefaultDigitalHumanLogic}.
 */
export interface DigitalHumanLogicOptions {
  /**
   * The adapter used to manage OpenClaw agents.
   */
  openClawAgentsAdapter: OpenClawAgentsAdapter;

  /**
   * The adapter used to list and delete OpenClaw cron jobs.
   */
  openClawCronAdapter: OpenClawCronAdapter;

  /**
   * Logic used to read and replace per-agent skill bindings (dip skills API).
   */
  agentSkillsLogic: AgentSkillsLogic;

  /**
   * Adapter used to persist per-digital-employee KWeaver tokens.
   */
  digitalEmployeeTokenAdapter?: DigitalEmployeeTokenAdapter;
}

/**
 * Logic implementation that derives digital humans from OpenClaw agents.
 */
export class DefaultDigitalHumanLogic implements DigitalHumanLogic {
  private readonly openClawAgentsAdapter: OpenClawAgentsAdapter;
  private readonly openClawCronAdapter: OpenClawCronAdapter;
  private readonly agentSkillsLogic: AgentSkillsLogic;
  private readonly digitalEmployeeTokenAdapter?: DigitalEmployeeTokenAdapter;

  /**
   * Creates the digital human logic.
   *
   * @param options Dependencies and configuration.
   */
  public constructor(options: DigitalHumanLogicOptions) {
    this.openClawAgentsAdapter = options.openClawAgentsAdapter;
    this.openClawCronAdapter = options.openClawCronAdapter;
    this.agentSkillsLogic = options.agentSkillsLogic;
    this.digitalEmployeeTokenAdapter = options.digitalEmployeeTokenAdapter;
  }

  /**
   * Fetches the digital human list.
   *
   * @returns The normalized digital human list.
   */
  public async listDigitalHumans(): Promise<DigitalHumanList> {
    const { agents } = await this.openClawAgentsAdapter.listAgents();
    const visibleAgents = agents.filter((agent) => !HIDDEN_DIGITAL_HUMAN_IDS.has(agent.id));

    return Promise.all(
      visibleAgents.map((agent) => this.getDigitalHuman(agent.id).catch(() => ({
        id: agent.id,
        name: agent.name ?? agent.identity?.name ?? agent.id,
        creature: undefined,
        soul: "",
        bkn: undefined,
        skills: undefined
      })))
    );
  }

  /**
   * Reads IDENTITY.md and SOUL.md for a given agent and maps them to
   * flat detail fields (name, creature, soul, bkn), plus skills and channel.
   *
   * @param id The digital human identifier.
   * @returns The detail payload.
   */
  public async getDigitalHuman(id: string): Promise<DigitalHumanDetail> {
    let identityContent: string;
    let soulContent: string;
    try {
      const [identityResult, soulResult] = await Promise.all([
        this.openClawAgentsAdapter.getAgentFile({
          agentId: id,
          name: "IDENTITY.md"
        }),
        this.openClawAgentsAdapter.getAgentFile({
          agentId: id,
          name: "SOUL.md"
        })
      ]);
      identityContent = identityResult.file.content ?? "";
      soulContent = soulResult.file.content ?? "";
    } catch (error: unknown) {
      throw toNotFoundIfAgentMissing(error, id);
    }

    const template = mergeFilesToTemplate(identityContent, soulContent);
    let skills: string[] | undefined;
    try {
      const binding = await this.agentSkillsLogic.getAgentSkills(id);
      skills =
        binding.skills.length > 0 ? binding.skills : undefined;
    } catch {
      skills = undefined;
    }

    const channel = await readChannelForAgent(id);

    return {
      id,
      name: template.identity.name || id,
      creature: template.identity.creature,
      icon_id: template.identity.icon_id,
      soul: template.soul,
      bkn: template.bkn,
      skills,
      ...(channel !== undefined ? { channel } : {})
    };
  }

  /**
   * Creates a new digital human by orchestrating the full setup flow
   * as specified in the design document:
   *
   * 1. Resolve the new agent id from `request.id`, or generate one UUID when omitted
   * 2. Create the agent in OpenClaw (`agents.create`)
   * 3. Update IDENTITY.md and SOUL.md via `agents.files.list` then `agents.files.set`
   * 4. Configure skills via {@link AgentSkillsLogic.updateAgentSkills}
   * 5. (optional) Bind channel via `config.get` + `config.set` WS RPCs.
   *
   * @param request The creation request payload.
   * @returns The created digital human summary.
   */
  public async createDigitalHuman(
    request: CreateDigitalHumanRequest
  ): Promise<CreateDigitalHumanResult> {
    const id = request.id?.trim() || randomUUID();
    const template = buildTemplate(request);

    const workspace = resolveDefaultWorkspace(id);

    await this.openClawAgentsAdapter.createAgent({
      name: id,
      workspace
    });

    await this.writeTemplateViaOpenClawFilesRpc(id, template);

    await this.writeDigitalEmployeeRecordToDatabase(
      id,
      request.kweaver_token ?? null
    );

    const skills = normalizeCreateDigitalHumanSkills(request.skills);
    await this.agentSkillsLogic.updateAgentSkills(id, skills);

    if (request.channel) {
      try {
        await this.bindChannelForAgent(id, request.channel, true);
      } catch (err) {
        if (err instanceof HttpError) {
          throw err;
        }
        console.error("[digital-human] channel binding failed (non-fatal):", err);
      }
    }

    return {
      id,
      name: request.name,
      creature: request.creature,
      icon_id: request.icon_id,
      soul: request.soul,
      skills,
      bkn: request.bkn,
      channel:
        request.channel !== undefined
          ? normalizeChannelForResponse(request.channel)
          : undefined
    };
  }

  /**
   * Deletes an existing digital human by delegating to the OpenClaw agent adapter.
   *
   * @param id The digital human identifier.
   * @param deleteFiles Whether to remove workspace files. Defaults to `false` to keep session history.
   */
  public async deleteDigitalHuman(
    id: string,
    deleteFiles?: boolean
  ): Promise<void> {
    const relatedCronJobs = await this.listCronJobsForDigitalHuman(id);

    try {
      await this.openClawAgentsAdapter.deleteAgent({
        agentId: id,
        deleteFiles: deleteFiles ?? false
      });
    } catch (error: unknown) {
      throw toNotFoundIfAgentMissing(error, id);
    }

    await Promise.all(
      relatedCronJobs.map(async (job) => {
        await this.openClawCronAdapter.removeCronJob({ id: job.id });
      })
    );

    await this.digitalEmployeeTokenAdapter?.markDigitalEmployeeDeleted(id);
  }

  /**
   * Applies a partial update: merges patch into current template, writes files,
   * optionally re-syncs skills and channel binding.
   *
   * @param id Agent UUID.
   * @param patch Partial fields.
   */
  public async updateDigitalHuman(
    id: string,
    patch: UpdateDigitalHumanRequest
  ): Promise<UpdateDigitalHumanResult> {
    let identityContent: string;
    let soulContent: string;
    try {
      const [identityResult, soulResult] = await Promise.all([
        this.openClawAgentsAdapter.getAgentFile({
          agentId: id,
          name: "IDENTITY.md"
        }),
        this.openClawAgentsAdapter.getAgentFile({
          agentId: id,
          name: "SOUL.md"
        })
      ]);
      identityContent = identityResult.file.content ?? "";
      soulContent = soulResult.file.content ?? "";
    } catch (error: unknown) {
      throw toNotFoundIfAgentMissing(error, id);
    }

    const current = mergeFilesToTemplate(identityContent, soulContent);
    const merged = mergeTemplatePatch(current, patch);
    if (patch.kweaver_token === null) {
      merged.bkn = [];
    }

    await this.writeTemplateViaOpenClawFilesRpc(id, merged);

    if (patch.kweaver_token !== undefined) {
      await this.writeKweaverTokenToDatabase(id, patch.kweaver_token);
    }

    let skillsOut: string[] | undefined;
    if (patch.skills !== undefined) {
      await this.agentSkillsLogic.updateAgentSkills(id, patch.skills);
      skillsOut = patch.skills.length > 0 ? patch.skills : undefined;
    } else {
      try {
        const binding = await this.agentSkillsLogic.getAgentSkills(id);
        skillsOut =
          binding.skills.length > 0 ? binding.skills : undefined;
      } catch {
        skillsOut = undefined;
      }
    }

    if (patch.channel) {
      try {
        await this.bindChannelForAgent(id, patch.channel, false);
      } catch (err) {
        if (err instanceof HttpError) {
          throw err;
        }
        console.error("[digital-human] channel binding failed (non-fatal):", err);
      }
    }

    return {
      id,
      name: merged.identity.name,
      creature: merged.identity.creature,
      icon_id: merged.identity.icon_id,
      soul: merged.soul,
      skills: skillsOut,
      bkn: merged.bkn,
      channel:
        patch.channel !== undefined
          ? normalizeChannelForResponse(patch.channel)
          : undefined
    };
  }

  /**
   * Updates IDENTITY.md, SOUL.md, and TOOLS.md through OpenClaw file RPCs:
   * `agents.files.list` then parallel `agents.files.set` calls.
   *
   * @param agentId The OpenClaw agent id.
   * @param template The template to render into markdown files.
   */
  private async writeTemplateViaOpenClawFilesRpc(
    agentId: string,
    template: DigitalHumanTemplate
  ): Promise<void> {
    await this.openClawAgentsAdapter.listAgentFiles({ agentId });
    const identityMd = renderIdentityMarkdown(template);
    const soulMd = renderSoulMarkdown(template);
    const toolsMd = renderToolsMarkdown();
    await Promise.all([
      this.openClawAgentsAdapter.setAgentFile({
        agentId,
        name: "IDENTITY.md",
        content: identityMd
      }),
      this.openClawAgentsAdapter.setAgentFile({
        agentId,
        name: "SOUL.md",
        content: soulMd
      }),
      this.openClawAgentsAdapter.setAgentFile({
        agentId,
        name: "TOOLS.md",
        content: toolsMd
      })
    ]);
  }

  /**
   * Binds channel credentials and routing: Feishu and DingTalk use
   * `channels.<feishu|dingtalk>.accounts.<accountId>` (derived from `appId`) and
   * `match.accountId` so multiple apps can coexist; each account may only be bound to one
   * agent (other agents' claims on that account are removed). For Feishu, each account
   * also sets `dmPolicy: "open"` and `allowFrom: ["*"]` so DMs reach the agent without
   * OpenClaw pairing (`openclaw pairing approve`). Persists the complete merged config
   * through `config.set` instead of patching, because `config.patch` schedules a gateway
   * restart while route bindings can be updated without restarting channels.
   *
   * @param agentId The OpenClaw agent id.
   * @param channel The channel configuration.
   * @param rejectExistingAppId Whether to reject AppIDs already configured for another agent.
   */
  private async bindChannelForAgent(
    agentId: string,
    channel: ChannelConfig,
    rejectExistingAppId: boolean
  ): Promise<void> {
    const configSnapshot = await this.openClawAgentsAdapter.getConfig();
    const merged = loadOpenClawConfigSnapshotForMerge(configSnapshot);
    if (rejectExistingAppId) {
      assertChannelAppIdIsAvailable(merged, agentId, channel);
    }
    applyAgentChannelBinding(merged, agentId, channel);
    await this.openClawAgentsAdapter.setConfig({
      raw: JSON.stringify(merged),
      baseHash: configSnapshot.hash
    });
  }

  /**
   * Fetches all cron jobs owned by the specified digital human.
   *
   * @param agentId The OpenClaw agent identifier.
   * @returns All cron jobs whose `agentId` matches the digital human id.
   */
  private async listCronJobsForDigitalHuman(
    agentId: string
  ): Promise<OpenClawCronJob[]> {
    const jobs: OpenClawCronJob[] = [];
    let offset = 0;

    while (true) {
      const result = await this.openClawCronAdapter.listCronJobs({
        includeDisabled: true,
        limit: DIGITAL_HUMAN_CRON_SCAN_LIMIT,
        offset,
        enabled: "all",
        sortBy: "updatedAtMs",
        sortDir: "desc"
      });

      jobs.push(...result.jobs.filter((job) => job.agentId === agentId));

      if (result.hasMore !== true || result.nextOffset === null) {
        break;
      }

      offset = result.nextOffset;
    }

    return jobs;
  }

  /**
   * Persists a digital employee record and optional KWeaver token.
   *
   * @param agentId Digital employee id, equal to the OpenClaw agent id.
   * @param token Token to write, or `null` when not configured.
   */
  private async writeDigitalEmployeeRecordToDatabase(
    agentId: string,
    token: string | null
  ): Promise<void> {
    if (this.digitalEmployeeTokenAdapter === undefined) {
      return;
    }

    await this.digitalEmployeeTokenAdapter.upsertKweaverToken(agentId, token);
  }

  /**
   * Persists a KWeaver token update into the digital employee table.
   *
   * @param agentId Digital employee id, equal to the OpenClaw agent id.
   * @param token Token to write, or `null` to remove the stored token.
   */
  private async writeKweaverTokenToDatabase(
    agentId: string,
    token: string | null
  ): Promise<void> {
    if (this.digitalEmployeeTokenAdapter === undefined) {
      return;
    }

    if (token === null) {
      await this.digitalEmployeeTokenAdapter.deleteKweaverToken(agentId);
    } else {
      await this.digitalEmployeeTokenAdapter.upsertKweaverToken(agentId, token);
    }
  }
}

/**
 * Resolves an isolated workspace directory for a given digital human id.
 *
 * Uses the digital human id as the workspace subdirectory name.
 *
 * @param uuid The digital human identifier.
 * @returns The absolute path to the agent-specific workspace.
 */
export function resolveDefaultWorkspace(uuid: string): string {
  return resolveOpenClawWorkspacePath(uuid);
}

/**
 * Maps gateway "agent missing" failures to HTTP 404.
 */
function toNotFoundIfAgentMissing(error: unknown, id: string): HttpError {
  const message =
    error instanceof Error ? error.message : String(error);
  const lower = message.toLowerCase();
  if (
    lower.includes("unknown agent") ||
    lower.includes("not found") ||
    lower.includes("no such agent")
  ) {
    return new HttpError(404, `Digital human not found: ${id}`);
  }
  if (error instanceof HttpError) {
    return error;
  }
  throw error instanceof Error ? error : new Error(String(error));
}

/**
 * Resolves the path to the OpenClaw config file.
 *
 * @returns The absolute path to the OpenClaw configuration file.
 */
export function resolveOpenClawConfigPath(): string {
  return join(homedir(), ".openclaw", "openclaw.json");
}

function resolveOpenClawChannelKey(channel: ChannelConfig): "feishu" | "dingtalk" {
  const t = channel.type ?? "feishu";
  return t === "dingtalk" ? "dingtalk" : "feishu";
}

function normalizeChannelForResponse(channel: ChannelConfig): ChannelConfig {
  return {
    type: channel.type ?? "feishu",
    appId: channel.appId,
    appSecret: channel.appSecret
  };
}

/**
 * Loads the parsed OpenClaw config object from the `config.get` response.
 *
 * @param snapshot The `config.get` result.
 * @throws HttpError when the gateway does not provide a parsed config object.
 */
function loadOpenClawConfigSnapshotForMerge(
  snapshot: OpenClawConfigGetResult
): Record<string, unknown> {
  const fromSnapshot = readOpenClawParsedConfigSnapshot(snapshot);
  if (fromSnapshot !== undefined) {
    return fromSnapshot;
  }

  throw new HttpError(
    502,
    "OpenClaw config.get did not return a parsed config object; refusing to call config.set"
  );
}

/**
 * Extracts the parsed config object from `config.get.config`.
 *
 * @param snapshot The `config.get` result.
 * @returns Parsed config object when available and object-shaped.
 */
function readOpenClawParsedConfigSnapshot(
  snapshot: OpenClawConfigGetResult
): Record<string, unknown> | undefined {
  if (typeof snapshot.config === "object" && snapshot.config !== null) {
    return snapshot.config as Record<string, unknown>;
  }

  return undefined;
}

const OPENCLAW_DEFAULT_ACCOUNT_ID = "default";

const BLOCKED_ACCOUNT_KEYS = new Set([
  "__proto__",
  "constructor",
  "prototype"
]);

/**
 * Derives a stable OpenClaw channel `accountId` from a provider app id (Feishu `cli_*`,
 * DingTalk app keys, etc.).
 * Aligns with OpenClaw's account-id normalization so bindings match gateway routing.
 */
export function normalizeOpenClawAccountIdFromAppId(appId: string): string {
  const trimmed = appId.trim();
  if (!trimmed) {
    return OPENCLAW_DEFAULT_ACCOUNT_ID;
  }
  const VALID_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
  if (VALID_ID_RE.test(trimmed)) {
    const lower = trimmed.toLowerCase();
    if (!BLOCKED_ACCOUNT_KEYS.has(lower)) {
      return lower;
    }
  }
  const INVALID_CHARS_RE = /[^a-z0-9_-]+/gi;
  const LEADING_DASH_RE = /^-+/;
  const TRAILING_DASH_RE = /-+$/;
  let canonical = trimmed
    .toLowerCase()
    .replace(INVALID_CHARS_RE, "-")
    .replace(LEADING_DASH_RE, "")
    .replace(TRAILING_DASH_RE, "")
    .slice(0, 64);
  if (!canonical || BLOCKED_ACCOUNT_KEYS.has(canonical)) {
    return OPENCLAW_DEFAULT_ACCOUNT_ID;
  }
  return canonical;
}

function bindingAccountKeyForChannel(
  match: { channel?: string; accountId?: string } | undefined,
  expectedChannel: "feishu" | "dingtalk"
): string | null {
  if (!match || match.channel !== expectedChannel) {
    return null;
  }
  const raw = typeof match.accountId === "string" ? match.accountId.trim() : "";
  if (!raw) {
    return OPENCLAW_DEFAULT_ACCOUNT_ID;
  }
  return normalizeOpenClawAccountIdFromAppId(raw);
}

/**
 * Rejects channel credentials whose AppID already exists in OpenClaw config.
 *
 * @param currentConfig Parsed OpenClaw config root.
 * @param agentId Target agent id.
 * @param channel Channel credentials being configured.
 * @throws HttpError when another configured account has the same AppID.
 */
function assertChannelAppIdIsAvailable(
  currentConfig: Record<string, unknown>,
  agentId: string,
  channel: ChannelConfig
): void {
  const channelKey = resolveOpenClawChannelKey(channel);
  const requestedAppId = channel.appId.trim();
  if (requestedAppId.length === 0) {
    return;
  }

  const channels = currentConfig.channels;
  if (typeof channels !== "object" || channels === null) {
    return;
  }

  const block = (channels as Record<string, unknown>)[channelKey];
  if (typeof block !== "object" || block === null) {
    return;
  }

  const existingAgentId = findAgentIdByChannelAppId(
    currentConfig,
    channelKey,
    block as Record<string, unknown>,
    requestedAppId
  );
  if (existingAgentId !== undefined && existingAgentId !== agentId) {
    throw new HttpError(
      400,
      `channel.appId has already been configured for ${channelKey}`
    );
  }
}

function findAgentIdByChannelAppId(
  currentConfig: Record<string, unknown>,
  channelKey: "feishu" | "dingtalk",
  channelBlock: Record<string, unknown>,
  appId: string
): string | undefined {
  const accountIds = new Set<string>();
  const accounts =
    typeof channelBlock.accounts === "object" && channelBlock.accounts !== null
      ? (channelBlock.accounts as Record<string, unknown>)
      : undefined;

  if (accounts !== undefined) {
    for (const [accountId, account] of Object.entries(accounts)) {
      if (typeof account !== "object" || account === null) {
        continue;
      }
      const existingAppId = (account as Record<string, unknown>).appId;
      if (typeof existingAppId === "string" && existingAppId.trim() === appId) {
        accountIds.add(normalizeOpenClawAccountIdFromAppId(accountId));
      }
    }
  }

  const legacyAppId = channelBlock.appId;
  if (typeof legacyAppId === "string" && legacyAppId.trim() === appId) {
    accountIds.add(OPENCLAW_DEFAULT_ACCOUNT_ID);
  }

  if (accountIds.size === 0) {
    return undefined;
  }

  const bindings = Array.isArray(currentConfig.bindings)
    ? currentConfig.bindings
    : [];
  for (const entry of bindings) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const binding = entry as {
      agentId?: unknown;
      match?: { channel?: string; accountId?: string };
    };
    const accountKey = bindingAccountKeyForChannel(binding.match, channelKey);
    if (
      typeof binding.agentId === "string" &&
      accountKey !== null &&
      accountIds.has(accountKey)
    ) {
      return binding.agentId;
    }
  }

  return "";
}

/**
 * Mutates config so this agent has exactly one channel binding row. Feishu and DingTalk use
 * `channels.<provider>.accounts.<accountId>` (one app id → one account → one agent). Other
 * agents' bindings are preserved except when they claim the same account on that channel
 * as this bind (then they are removed).
 *
 * @param currentConfig Parsed config root.
 * @param agentId Target agent id.
 * @param channel Channel credentials and type.
 */
function applyAgentChannelBinding(
  currentConfig: Record<string, unknown>,
  agentId: string,
  channel: ChannelConfig
): void {
  const channelKey = resolveOpenClawChannelKey(channel);
  const existingBindings = Array.isArray(currentConfig.bindings)
    ? (currentConfig.bindings as unknown[])
    : [];

  const withoutThisAgent = existingBindings.filter((entry) => {
    if (typeof entry === "object" && entry !== null && "agentId" in entry) {
      return (entry as { agentId: string }).agentId !== agentId;
    }
    return true;
  });

  const existingChannels =
    typeof currentConfig.channels === "object" && currentConfig.channels !== null
      ? (currentConfig.channels as Record<string, unknown>)
      : {};

  const accountId = normalizeOpenClawAccountIdFromAppId(channel.appId);
  const filteredBindings = withoutThisAgent.filter((entry) => {
    if (typeof entry !== "object" || entry === null || !("match" in entry)) {
      return true;
    }
    const m = (entry as { match?: { channel?: string; accountId?: string } }).match;
    const acc = bindingAccountKeyForChannel(m, channelKey);
    if (acc === null || acc !== accountId) {
      return true;
    }
    return false;
  });

  const prevBlock =
    typeof existingChannels[channelKey] === "object" &&
    existingChannels[channelKey] !== null
      ? (existingChannels[channelKey] as Record<string, unknown>)
      : {};
  const prevAccounts: Record<string, unknown> =
    typeof prevBlock.accounts === "object" && prevBlock.accounts !== null
      ? { ...(prevBlock.accounts as Record<string, unknown>) }
      : {};

  const prevEntry =
    typeof prevAccounts[accountId] === "object" && prevAccounts[accountId] !== null
      ? (prevAccounts[accountId] as Record<string, unknown>)
      : {};

  prevAccounts[accountId] = {
    ...prevEntry,
    enabled: true,
    appId: channel.appId.trim(),
    appSecret: channel.appSecret,
    // OpenClaw Feishu default is dmPolicy=pairing (requires `openclaw pairing approve`).
    // Digital employees should talk to the agent without manual pairing.
    ...(channelKey === "feishu"
      ? {
          dmPolicy: "open",
          allowFrom: ["*"]
        }
      : {})
  };

  currentConfig.bindings = [
    ...filteredBindings,
    {
      agentId,
      match: { channel: channelKey, accountId }
    }
  ];
  currentConfig.channels = {
    ...existingChannels,
    [channelKey]: {
      ...prevBlock,
      enabled: prevBlock.enabled !== false,
      accounts: prevAccounts
    }
  };
}

/**
 * Reads channel credentials from disk when the agent has a matching
 * `bindings` entry (same shape as channel binding on create/update).
 */
async function readChannelForAgent(
  agentId: string
): Promise<ChannelConfig | undefined> {
  const configPath = resolveOpenClawConfigPath();
  let raw: string;
  try {
    raw = await readFile(configPath, "utf-8");
  } catch {
    return undefined;
  }

  let config: Record<string, unknown>;
  try {
    config = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const bindings = Array.isArray(config.bindings) ? config.bindings : [];
  const binding = bindings.find((entry) => {
    if (typeof entry !== "object" || entry === null) {
      return false;
    }
    const e = entry as Record<string, unknown>;
    return e.agentId === agentId;
  });
  if (binding === undefined) {
    return undefined;
  }
  const match = (binding as Record<string, unknown>).match;
  if (typeof match !== "object" || match === null) {
    return undefined;
  }
  const channelKey = (match as { channel?: string }).channel;
  if (channelKey !== "feishu" && channelKey !== "dingtalk") {
    return undefined;
  }

  const channels = config.channels;
  if (typeof channels !== "object" || channels === null) {
    return undefined;
  }
  const block = (channels as Record<string, unknown>)[channelKey];
  if (typeof block !== "object" || block === null) {
    return undefined;
  }
  const f = block as Record<string, unknown>;

  let appId = "";
  let appSecret = "";
  const accountIdRaw = (match as { accountId?: string }).accountId;
  const accountKey =
    typeof accountIdRaw === "string" && accountIdRaw.trim().length > 0
      ? normalizeOpenClawAccountIdFromAppId(accountIdRaw)
      : OPENCLAW_DEFAULT_ACCOUNT_ID;
  const accounts =
    typeof f.accounts === "object" && f.accounts !== null
      ? (f.accounts as Record<string, unknown>)
      : undefined;
  const sub =
    accounts && typeof accounts[accountKey] === "object" && accounts[accountKey] !== null
      ? (accounts[accountKey] as Record<string, unknown>)
      : undefined;
  if (sub) {
    appId = typeof sub.appId === "string" ? sub.appId.trim() : "";
    appSecret = typeof sub.appSecret === "string" ? sub.appSecret.trim() : "";
  }
  if (appId.length === 0 || appSecret.length === 0) {
    appId = typeof f.appId === "string" ? f.appId.trim() : "";
    appSecret = typeof f.appSecret === "string" ? f.appSecret.trim() : "";
  }

  if (appId.length === 0 || appSecret.length === 0) {
    return undefined;
  }
  const type: DigitalHumanChannelType =
    channelKey === "dingtalk" ? "dingtalk" : "feishu";
  return { type, appId, appSecret };
}
