/**
 * Supported channel user providers stored in `channel-users.jsonl`.
 */
export type ChannelUserType = "feishu" | "dingding";

/**
 * One channel endpoint bound to a user.
 */
export interface ChannelUserChannel {
  /**
   * Messaging channel provider.
   */
  type: ChannelUserType;

  /**
   * Channel-specific user ID.
   */
  user_id: string;
}

/**
 * One persisted channel user record.
 */
export interface ChannelUser {
  /**
   * Stable API identifier derived from the channel type and User ID.
   * This field is returned by the HTTP API and is not persisted in JSONL.
   */
  id: string;

  /**
   * Human-readable display name.
   */
  displayName: string;

  /**
   * Bound channel account information.
   */
  channel: ChannelUserChannel;
}

/**
 * One channel user item returned by the list API.
 */
export interface ChannelUserListItem {
  /**
   * Human-readable display name.
   */
  displayName: string;

  /**
   * Bound channel account information.
   */
  channel: ChannelUserChannel;
}

/**
 * Query parameters supported by the channel user list endpoint.
 */
export interface ChannelUserListQuery {
  /**
   * Optional channel filter.
   */
  type?: ChannelUserType;

  /**
   * Optional exact display name filter.
   */
  displayName?: string;

  /**
   * Zero-based pagination offset.
   */
  start?: number;

  /**
   * Maximum number of items to return.
   */
  limit?: number;
}

/**
 * List response returned by the channel user query endpoint.
 */
export interface ChannelUserListResponse {
  /**
   * Paged channel user records.
   */
  items: ChannelUserListItem[];

  /**
   * Total record count after filtering and before pagination.
   */
  total: number;

  /**
   * Zero-based pagination offset used for this response.
   */
  start: number;

  /**
   * Maximum number of items requested for this page.
   */
  limit: number;
}

/**
 * Request body used to create or update one channel user.
 */
export interface UpsertChannelUserRequest {
  /**
   * Human-readable display name.
   */
  displayName: string;

  /**
   * Target channel account data.
   */
  channel: ChannelUserChannel;
}

/**
 * One JSONL import validation error.
 */
export interface ChannelUserImportError {
  /**
   * One-based line number in the uploaded JSONL file.
   */
  line: number;

  /**
   * Original raw line content.
   */
  raw: string;

  /**
   * Human-readable validation failure reason.
   */
  reason: string;
}

/**
 * Success response returned by JSONL import.
 */
export interface ChannelUserImportResult {
  /**
   * Number of imported channel user records.
   */
  count: number;
}

/**
 * Export payload returned by the JSONL export logic.
 */
export interface ChannelUserExportResult {
  /**
   * Download filename.
   */
  filename: string;

  /**
   * Serialized JSONL content.
   */
  content: string;
}

/**
 * Request body used to update a digital human's channel user whitelist.
 */
export interface UpdateDigitalHumanChannelUsersRequest {
  /**
   * Selected channel user IDs.
   */
  allowFrom: string[];
}

/**
 * Response body returned after updating a digital human's channel user whitelist.
 */
export interface DigitalHumanChannelUsersResponse {
  /**
   * Target digital human identifier.
   */
  digitalHumanId: string;

  /**
   * Target channel type derived from the digital human binding.
   */
  channelType: ChannelUserType;

  /**
   * Effective User ID whitelist written to `allowFrom`.
   */
  allowFrom: string[];
}
