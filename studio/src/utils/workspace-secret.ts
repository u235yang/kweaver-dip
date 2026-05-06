import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Resolves an OpenClaw agent workspace directory.
 *
 * @param agentId The OpenClaw agent identifier.
 * @returns The absolute workspace path under `~/.openclaw/workspace`.
 */
export function resolveOpenClawWorkspacePath(agentId: string): string {
  return join(homedir(), ".openclaw", "workspace", agentId);
}

/**
 * Resolves the direct filesystem path for an agent workspace SECRET file.
 *
 * @param agentId The OpenClaw agent identifier.
 * @returns The absolute SECRET file path under the agent workspace.
 */
export function resolveWorkspaceSecretPath(agentId: string): string {
  return join(resolveOpenClawWorkspacePath(agentId), "SECRET");
}

/**
 * Reads an agent workspace SECRET file directly from disk.
 *
 * @param agentId The OpenClaw agent identifier.
 * @returns The SECRET file content, or an empty string when the file does not exist.
 */
export async function readWorkspaceSecret(agentId: string): Promise<string> {
  try {
    return await readFile(resolveWorkspaceSecretPath(agentId), "utf-8");
  } catch (error: unknown) {
    if (isFileMissingError(error)) {
      return "";
    }
    throw error;
  }
}

/**
 * Writes an agent workspace SECRET file directly to disk, creating the workspace
 * directory when needed.
 *
 * @param agentId The OpenClaw agent identifier.
 * @param content The full SECRET file content to write.
 */
export async function writeWorkspaceSecret(
  agentId: string,
  content: string
): Promise<void> {
  const secretPath = resolveWorkspaceSecretPath(agentId);
  await mkdir(dirname(secretPath), { recursive: true });
  await writeFile(secretPath, content, "utf-8");
}

/**
 * Reads, transforms, and writes an agent workspace SECRET file.
 *
 * @param agentId The OpenClaw agent identifier.
 * @param updater Receives the current content and returns the next content.
 */
export async function updateWorkspaceSecret(
  agentId: string,
  updater: (content: string) => string | Promise<string>
): Promise<void> {
  const currentContent = await readWorkspaceSecret(agentId);
  await writeWorkspaceSecret(agentId, await updater(currentContent));
}

/**
 * Checks whether a filesystem read failed because the target file is absent.
 *
 * @param error The caught read error.
 * @returns Whether the error is an ENOENT-style missing-file error.
 */
function isFileMissingError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}
