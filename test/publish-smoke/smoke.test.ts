import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { spawnCapturing, type SpawnCapturingParams } from "../cli-helpers.ts";
import { copyFixture, makeTempDir } from "../fixture-helpers.ts";

const repoRoot = join(import.meta.dirname, "..", "..");
const PACKAGE_NAME = "@fal-works/lint-js-global";

interface PublishLayout {
  packageRoot: string;
  binPath: string;
  dispose: () => void;
}

/** Run a command via {@link spawnCapturing} and throw if it exits non-zero. */
async function runOrThrow(params: SpawnCapturingParams): Promise<void> {
  const result = await spawnCapturing(params);
  if (result.status !== 0) {
    const sandboxHint = maybeSandboxFailureHint(params.name, result.stdout, result.stderr);
    throw new Error(
      `${params.name} failed: exit ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}${sandboxHint ? `\n\n${sandboxHint}` : ""}`,
    );
  }
}

function maybeSandboxFailureHint(name: string, stdout: string, stderr: string): string | null {
  if (name !== "pnpm install") return null;

  const output = `${stdout}\n${stderr}`;
  const matchesRestrictedNetwork =
    output.includes("EAI_AGAIN") && output.includes("registry.npmjs.org");
  const matchesReadOnlyStore =
    output.includes("EROFS") &&
    output.includes("read-only file system") &&
    output.includes("/store/v");
  if (!matchesRestrictedNetwork && !matchesReadOnlyStore) return null;

  return "If this ran in the AI agent sandbox, sandbox restrictions may be the cause. Re-run `pnpm smoke:publish` outside the sandbox.";
}

/**
 * Install the packed tarball into a fresh consumer directory and return paths into it.
 *
 * Going through `pnpm install` makes the smoke see the same dependency graph and
 * `node_modules/.bin/` shims a downstream user would. An undeclared runtime dep
 * or a `bin` target outside `files` then fails the smoke instead of the first user run.
 */
async function preparePublishLayout(): Promise<PublishLayout> {
  const root = makeTempDir("smoke");
  const dispose = () => rmSync(root, { recursive: true, force: true });
  try {
    await runOrThrow({
      name: "pnpm pack",
      command: "pnpm",
      args: ["pack", "--pack-destination", root],
      cwd: repoRoot,
    });
    const tarballs = readdirSync(root).filter((name) => name.endsWith(".tgz"));
    const [tarballName, ...rest] = tarballs;
    if (!tarballName || rest.length > 0) {
      throw new Error(
        `expected exactly one .tgz in pack dir, found: ${tarballs.join(", ") || "(none)"}`,
      );
    }
    const tarballPath = join(root, tarballName);

    const consumerDir = join(root, "consumer");
    const storeDir = join(root, "store");
    mkdirSync(consumerDir);
    writeFileSync(
      join(consumerDir, "package.json"),
      `${JSON.stringify(
        {
          name: "lint-js-smoke-consumer",
          private: true,
          dependencies: { [PACKAGE_NAME]: `file:${tarballPath}` },
        },
        null,
        2,
      )}\n`,
    );
    // Self-contained store, so the smoke runs even where the default pnpm store is read-only.
    await runOrThrow({
      name: "pnpm install",
      command: "pnpm",
      args: ["install", "--store-dir", storeDir, "--ignore-workspace"],
      cwd: consumerDir,
    });

    return {
      packageRoot: join(consumerDir, "node_modules", PACKAGE_NAME),
      binPath: join(consumerDir, "node_modules", ".bin", "lint-js"),
      dispose,
    };
  } catch (err) {
    dispose();
    throw err;
  }
}

void describe("smoke against the published layout", () => {
  let layout: PublishLayout;

  // package.json runs this file with `--test-isolation=none` so setup failures here
  // keep their command output instead of collapsing into a file-level runner failure.
  before(async () => {
    layout = await preparePublishLayout();
  });
  after(() => {
    layout?.dispose();
  });

  void it("--help: prints usage and exits 0", async () => {
    const result = await spawnCapturing({
      name: "lint-js --help",
      command: layout.binPath,
      args: ["--help"],
    });
    assert.equal(result.status, 0, `expected exit 0\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /Usage: lint-js/, "expected usage on stdout");
  });

  void it("--check on basic fixture: reaches underlying tools (exit 1 = findings)", async (t) => {
    // `basic` is intentionally dirty, so a successful end-to-end run reports findings and exits 1.
    // Exit 1 therefore proves the full pipeline reached the underlying tools.
    // Exit 2 would mean a `LintJsError` aborted the run before findings were produced.
    const dir = copyFixture("basic");
    t.after(() => rmSync(dir, { recursive: true, force: true }));

    const result = await spawnCapturing({
      name: "lint-js --check",
      command: layout.binPath,
      args: ["--check"],
      cwd: dir,
    });
    assert.equal(
      result.status,
      1,
      `expected exit 1, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  });

  void it("shipped-paths: every path exported by package/paths.ts exists", async () => {
    // Some entries appear as strings in CLI output without being read at startup,
    // so their absence would slip past the CLI-running tests above.
    const url = pathToFileURL(join(layout.packageRoot, "dist", "package", "paths.js")).href;
    const mod: unknown = await import(url);
    assert.ok(
      typeof mod === "object" && mod !== null,
      "expected module namespace object from package/paths.js",
    );
    const missing = Object.entries(mod as Record<string, unknown>)
      .filter(([, value]) => typeof value === "string" && !existsSync(value))
      .map(([name, value]) => `${name} -> ${value as string}`);
    assert.deepEqual(
      missing,
      [],
      `shipped paths missing:\n${missing.map((m) => `  - ${m}`).join("\n")}`,
    );
  });
});
