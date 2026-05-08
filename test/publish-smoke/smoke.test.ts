import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dirname, "..", "..");
const fixtureRoot = join(repoRoot, "test", "fixtures");

interface PublishLayout {
  packageRoot: string;
  distCli: string;
  dispose: () => void;
}

/**
 * Build a temp install of the package as it will be published.
 *
 * Smoke checks against this layout exercise `package.json` `files` resolution,
 * so a missing shipped asset (e.g. `cfg/` or `docs/guide/`) fails the smoke
 * rather than surfacing on the first user run.
 *
 * The repo's `node_modules` is symlinked into the extracted package so runtime
 * dependency resolution succeeds without a fresh install.
 */
function preparePublishLayout(): PublishLayout {
  const packDir = mkdtempSync(join(tmpdir(), "lint-js-smoke-pack-"));
  const extractDir = mkdtempSync(join(tmpdir(), "lint-js-smoke-extracted-"));
  const dispose = () => {
    rmSync(packDir, { recursive: true, force: true });
    rmSync(extractDir, { recursive: true, force: true });
  };
  try {
    const packResult = spawnSync("pnpm", ["pack", "--pack-destination", packDir], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    if (packResult.status !== 0) {
      throw new Error(`pnpm pack failed: exit ${packResult.status}\nstderr:\n${packResult.stderr}`);
    }
    const tarballs = readdirSync(packDir).filter((name) => name.endsWith(".tgz"));
    const [tarballName, ...rest] = tarballs;
    if (!tarballName || rest.length > 0) {
      throw new Error(
        `expected exactly one .tgz in pack dir, found: ${tarballs.join(", ") || "(none)"}`,
      );
    }
    const tarballPath = join(packDir, tarballName);
    const tarResult = spawnSync("tar", ["-xf", tarballPath, "-C", extractDir], {
      encoding: "utf8",
    });
    if (tarResult.status !== 0) {
      throw new Error(`tar extract failed: exit ${tarResult.status}\nstderr:\n${tarResult.stderr}`);
    }
    const packageRoot = join(extractDir, "package");
    symlinkSync(join(repoRoot, "node_modules"), join(packageRoot, "node_modules"));
    return {
      packageRoot,
      distCli: join(packageRoot, "dist", "cli.js"),
      dispose,
    };
  } catch (err) {
    dispose();
    throw err;
  }
}

void describe("smoke against the published layout", () => {
  let layout: PublishLayout;

  before(() => {
    layout = preparePublishLayout();
  });
  after(() => {
    layout?.dispose();
  });

  void it("--help: prints usage and exits 0", () => {
    const result = spawnSync(process.execPath, [layout.distCli, "--help"], { encoding: "utf8" });
    assert.equal(result.status, 0, `expected exit 0\nstderr:\n${result.stderr}`);
    assert.match(result.stdout, /Usage: lint-js/, "expected usage on stdout");
  });

  void it("--check on basic fixture: reaches underlying tools (exit 1 = findings)", (t) => {
    // `basic` is intentionally dirty, so a successful end-to-end run reports findings and exits 1.
    // Exit 1 therefore proves the full pipeline reached the underlying tools.
    // Exit 2 would mean a `LintJsError` aborted the run before findings were produced.
    const dir = mkdtempSync(join(tmpdir(), "lint-js-smoke-basic-"));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    cpSync(join(fixtureRoot, "basic"), dir, { recursive: true });

    const result = spawnSync(process.execPath, [layout.distCli, "--check"], {
      cwd: dir,
      encoding: "utf8",
    });
    assert.equal(
      result.status,
      1,
      `expected exit 1, got ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  });

  void it("shipped-paths: every path exported by package-paths.ts exists", async () => {
    // Some entries (e.g. doc paths embedded in diagnostic hints) appear as strings in CLI output
    // without being read at startup, so their absence would slip past the CLI-running stages above.
    const url = pathToFileURL(join(layout.packageRoot, "dist", "package-paths.js")).href;
    const mod: unknown = await import(url);
    assert.ok(
      typeof mod === "object" && mod !== null,
      "expected module namespace object from package-paths.js",
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
