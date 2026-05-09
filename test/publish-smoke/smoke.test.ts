import assert from "node:assert/strict";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

import { spawnCapturing } from "../cli-helpers.ts";

const repoRoot = join(import.meta.dirname, "..", "..");
const fixtureRoot = join(repoRoot, "test", "fixtures");
const PACKAGE_NAME = "@fal-works/lint-js-global";

interface PublishLayout {
  packageRoot: string;
  binPath: string;
  dispose: () => void;
}

/**
 * Install the packed tarball into a fresh consumer directory and return paths into it.
 *
 * Going through `pnpm install` makes the smoke see the same dependency graph and
 * `node_modules/.bin/` shims a downstream user would. An undeclared runtime dep
 * or a `bin` target outside `files` then fails the smoke instead of the first user run.
 */
async function preparePublishLayout(): Promise<PublishLayout> {
  const root = mkdtempSync(join(tmpdir(), "lint-js-smoke-"));
  const dispose = () => rmSync(root, { recursive: true, force: true });
  try {
    const pack = await spawnCapturing({
      name: "pnpm pack",
      command: "pnpm",
      args: ["pack", "--pack-destination", root],
      cwd: repoRoot,
    });
    if (pack.status !== 0) {
      throw new Error(`pnpm pack failed: exit ${pack.status}\nstderr:\n${pack.stderr}`);
    }
    const tarballs = readdirSync(root).filter((name) => name.endsWith(".tgz"));
    const [tarballName, ...rest] = tarballs;
    if (!tarballName || rest.length > 0) {
      throw new Error(
        `expected exactly one .tgz in pack dir, found: ${tarballs.join(", ") || "(none)"}`,
      );
    }
    const tarballPath = join(root, tarballName);

    const consumerDir = join(root, "consumer");
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
    const install = await spawnCapturing({
      name: "pnpm install",
      command: "pnpm",
      args: ["install", "--prefer-offline", "--ignore-workspace"],
      cwd: consumerDir,
    });
    if (install.status !== 0) {
      throw new Error(
        `pnpm install failed: exit ${install.status}\nstdout:\n${install.stdout}\nstderr:\n${install.stderr}`,
      );
    }

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
    const dir = mkdtempSync(join(tmpdir(), "lint-js-smoke-basic-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(join(fixtureRoot, "basic"), dir, { recursive: true });

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
    const missing: string[] = [];
    for (const [name, value] of Object.entries(mod as Record<string, unknown>)) {
      if (typeof value !== "string") continue;
      if (!existsSync(value)) missing.push(`${name} -> ${value}`);
    }
    assert.deepEqual(
      missing,
      [],
      `shipped paths missing:\n${missing.map((m) => `  - ${m}`).join("\n")}`,
    );
  });
});
