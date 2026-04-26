// @ts-check

import { statSync } from "node:fs";

/**
 * Returns ignore patterns that apply regardless of project configuration.
 *
 * - `node_modules` (unanchored, any depth): oxlint does not skip it unless an `.eslintignore` is
 *   present. oxfmt already skips it by default, so the pattern is a no-op there.
 * - `/.mcp.json`, `/.claude` (root-anchored): Claude Code's sandbox bind-mounts these to `/dev/null`
 *   at the project root, causing oxfmt / oxlint to fail with `Failed to read` / `EROFS`. Detected
 *   via `$HOME` dotfiles shadowed as character devices at the project root: always shadowed inside
 *   the sandbox, never legitimate in a JS/TS project root.
 *
 * @returns {string[]} Gitignore-style patterns.
 */
export function getSystemIgnorePatterns() {
  const patterns = ["node_modules"];

  const claudeSandboxSentinels = [".bashrc", ".gitconfig"];
  const inClaudeSandbox = claudeSandboxSentinels.some((path) => {
    try {
      return statSync(path).isCharacterDevice();
    } catch {
      return false;
    }
  });
  if (inClaudeSandbox) patterns.push("/.mcp.json", "/.claude");

  return patterns;
}
