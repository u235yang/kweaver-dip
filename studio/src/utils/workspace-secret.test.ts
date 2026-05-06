import { mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  readWorkspaceSecret,
  resolveOpenClawWorkspacePath,
  resolveWorkspaceSecretPath,
  updateWorkspaceSecret,
  writeWorkspaceSecret
} from "./workspace-secret";

describe("workspace-secret utilities", () => {
  let fakeHome: string;

  beforeEach(() => {
    fakeHome = mkdtempSync(join(tmpdir(), "workspace-secret-"));
    fakeHomeForOsMock = fakeHome;
  });

  afterEach(() => {
    fakeHomeForOsMock = "/tmp";
    rmSync(fakeHome, { recursive: true, force: true });
  });

  it("resolves workspace and SECRET paths", () => {
    expect(resolveOpenClawWorkspacePath("agent-1")).toBe(
      join(fakeHome, ".openclaw", "workspace", "agent-1")
    );
    expect(resolveWorkspaceSecretPath("agent-1")).toBe(
      join(fakeHome, ".openclaw", "workspace", "agent-1", "SECRET")
    );
  });

  it("reads missing SECRET files as empty content", async () => {
    await expect(readWorkspaceSecret("agent-1")).resolves.toBe("");
  });

  it("writes SECRET files and creates the workspace directory", async () => {
    await writeWorkspaceSecret("agent-1", "A=1\n");

    expect(readFileSync(resolveWorkspaceSecretPath("agent-1"), "utf8")).toBe(
      "A=1\n"
    );
  });

  it("updates SECRET files from their current content", async () => {
    await writeWorkspaceSecret("agent-1", "A=1\n");
    await updateWorkspaceSecret("agent-1", (content) => `${content}B=2\n`);

    await expect(readWorkspaceSecret("agent-1")).resolves.toBe("A=1\nB=2\n");
  });
});
