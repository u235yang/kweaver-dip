import type { Pool } from "mysql2/promise";
import { describe, expect, it, vi } from "vitest";

import { DefaultDigitalEmployeeTokenAdapter } from "./digital-employee-token-adapter";

/**
 * Creates a minimal MySQL pool test double.
 *
 * @returns A mocked pool.
 */
function createPoolDouble(): Pool {
  return {
    execute: vi.fn()
  } as unknown as Pool;
}

describe("DefaultDigitalEmployeeTokenAdapter", () => {
  it("reads the token by agent id", async () => {
    const pool = createPoolDouble();
    vi.mocked(pool.execute).mockResolvedValue([
      [{ kweaver_token: "token-1" }],
      []
    ] as never);
    const adapter = new DefaultDigitalEmployeeTokenAdapter(pool);

    await expect(adapter.findKweaverToken("agent-1")).resolves.toBe("token-1");
    expect(pool.execute).toHaveBeenCalledWith(
      [
        "SELECT kweaver_token FROM t_digital_employee",
        "WHERE id = :agentId AND is_deleted = FALSE",
        "LIMIT 1"
      ].join(" "),
      { agentId: "agent-1" }
    );
  });

  it("returns undefined for missing rows", async () => {
    const pool = createPoolDouble();
    vi.mocked(pool.execute).mockResolvedValue([[], []] as never);
    const adapter = new DefaultDigitalEmployeeTokenAdapter(pool);

    await expect(adapter.findKweaverToken("agent-1")).resolves.toBeUndefined();
  });

  it("returns undefined for null token values", async () => {
    const pool = createPoolDouble();
    vi.mocked(pool.execute).mockResolvedValue([
      [{ kweaver_token: null }],
      []
    ] as never);
    const adapter = new DefaultDigitalEmployeeTokenAdapter(pool);

    await expect(adapter.findKweaverToken("agent-1")).resolves.toBeUndefined();
  });

  it("upserts the token by agent id", async () => {
    const pool = createPoolDouble();
    vi.mocked(pool.execute).mockResolvedValue([[], []] as never);
    const adapter = new DefaultDigitalEmployeeTokenAdapter(pool);

    await adapter.upsertKweaverToken("agent-1", "token-1");

    expect(pool.execute).toHaveBeenCalledWith(
      [
        "INSERT INTO t_digital_employee (id, kweaver_token, is_deleted)",
        "VALUES (:agentId, :token, FALSE)",
        "ON DUPLICATE KEY UPDATE",
        "kweaver_token = VALUES(kweaver_token),",
        "is_deleted = FALSE"
      ].join(" "),
      { agentId: "agent-1", token: "token-1" }
    );
  });

  it("upserts a digital employee row without a configured token", async () => {
    const pool = createPoolDouble();
    vi.mocked(pool.execute).mockResolvedValue([[], []] as never);
    const adapter = new DefaultDigitalEmployeeTokenAdapter(pool);

    await adapter.upsertKweaverToken("agent-1", null);

    expect(pool.execute).toHaveBeenCalledWith(
      [
        "INSERT INTO t_digital_employee (id, kweaver_token, is_deleted)",
        "VALUES (:agentId, :token, FALSE)",
        "ON DUPLICATE KEY UPDATE",
        "kweaver_token = VALUES(kweaver_token),",
        "is_deleted = FALSE"
      ].join(" "),
      { agentId: "agent-1", token: null }
    );
  });

  it("clears the token by agent id", async () => {
    const pool = createPoolDouble();
    vi.mocked(pool.execute).mockResolvedValue([[], []] as never);
    const adapter = new DefaultDigitalEmployeeTokenAdapter(pool);

    await adapter.deleteKweaverToken("agent-1");

    expect(pool.execute).toHaveBeenCalledWith(
      "UPDATE t_digital_employee SET kweaver_token = NULL WHERE id = :agentId",
      { agentId: "agent-1" }
    );
  });

  it("marks the digital employee as deleted", async () => {
    const pool = createPoolDouble();
    vi.mocked(pool.execute).mockResolvedValue([[], []] as never);
    const adapter = new DefaultDigitalEmployeeTokenAdapter(pool);

    await adapter.markDigitalEmployeeDeleted("agent-1");

    expect(pool.execute).toHaveBeenCalledWith(
      "UPDATE t_digital_employee SET is_deleted = TRUE WHERE id = :agentId",
      { agentId: "agent-1" }
    );
  });
});
