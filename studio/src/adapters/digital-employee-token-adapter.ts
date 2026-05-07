import type { Pool, RowDataPacket } from "mysql2/promise";

/**
 * Port used by MCP logic to read digital employee token data.
 */
export interface DigitalEmployeeTokenAdapter {
  /**
   * Finds the KWeaver token for one digital employee.
   *
   * @param agentId Digital employee id, equal to the OpenClaw agent id.
   * @returns The token when present, otherwise `undefined`.
   */
  findKweaverToken(agentId: string): Promise<string | undefined>;

  /**
   * Writes or replaces the KWeaver token for one digital employee.
   *
   * @param agentId Digital employee id, equal to the OpenClaw agent id.
   * @param token KWeaver token to store, or `null` when not configured.
   */
  upsertKweaverToken(agentId: string, token: string | null): Promise<void>;

  /**
   * Removes the KWeaver token for one digital employee.
   *
   * @param agentId Digital employee id, equal to the OpenClaw agent id.
   */
  deleteKweaverToken(agentId: string): Promise<void>;

  /**
   * Marks one digital employee as deleted.
   *
   * @param agentId Digital employee id, equal to the OpenClaw agent id.
   */
  markDigitalEmployeeDeleted(agentId: string): Promise<void>;
}

interface DigitalEmployeeTokenRow extends RowDataPacket {
  kweaver_token: string | null;
}

/**
 * Adapter that exposes digital employee token persistence to application logic.
 */
export class DefaultDigitalEmployeeTokenAdapter implements DigitalEmployeeTokenAdapter {
  /**
   * Creates the adapter.
   *
   * @param pool MariaDB connection pool.
   */
  public constructor(private readonly pool: Pool) {}

  /**
   * Finds the KWeaver token for one digital employee.
   *
   * @param agentId Digital employee id, equal to the OpenClaw agent id.
   * @returns The token when present, otherwise `undefined`.
   */
  public async findKweaverToken(agentId: string): Promise<string | undefined> {
    const [rows] = await this.pool.execute<DigitalEmployeeTokenRow[]>(
      [
        "SELECT kweaver_token FROM t_digital_employee",
        "WHERE id = :agentId AND is_deleted = FALSE",
        "LIMIT 1"
      ].join(" "),
      { agentId }
    );
    const token = rows[0]?.kweaver_token;

    return token === null ? undefined : token;
  }

  /**
   * Writes or replaces the KWeaver token for one digital employee.
   *
   * @param agentId Digital employee id, equal to the OpenClaw agent id.
   * @param token KWeaver token to store, or `null` when not configured.
   */
  public async upsertKweaverToken(
    agentId: string,
    token: string | null
  ): Promise<void> {
    await this.pool.execute(
      [
        "INSERT INTO t_digital_employee (id, kweaver_token, is_deleted)",
        "VALUES (:agentId, :token, FALSE)",
        "ON DUPLICATE KEY UPDATE",
        "kweaver_token = VALUES(kweaver_token),",
        "is_deleted = FALSE"
      ].join(" "),
      { agentId, token }
    );
  }

  /**
   * Removes the KWeaver token for one digital employee.
   *
   * @param agentId Digital employee id, equal to the OpenClaw agent id.
   */
  public async deleteKweaverToken(agentId: string): Promise<void> {
    await this.pool.execute(
      "UPDATE t_digital_employee SET kweaver_token = NULL WHERE id = :agentId",
      { agentId }
    );
  }

  /**
   * Marks one digital employee as deleted.
   *
   * @param agentId Digital employee id, equal to the OpenClaw agent id.
   */
  public async markDigitalEmployeeDeleted(agentId: string): Promise<void> {
    await this.pool.execute(
      "UPDATE t_digital_employee SET is_deleted = TRUE WHERE id = :agentId",
      { agentId }
    );
  }
}
