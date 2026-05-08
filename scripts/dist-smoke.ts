import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const repoRoot = join(import.meta.dirname, "..");
const fixtureRoot = join(repoRoot, "test", "fixtures");

interface SmokeResult {
  ok: boolean;
  detail: string;
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
function preparePublishLayout(): {
  packageRoot: string;
  distCli: string;
  dispose: () => void;
} {
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

function smokeHelp(distCli: string): SmokeResult {
  const result = spawnSync(process.execPath, [distCli, "--help"], { encoding: "utf8" });
  if (result.status !== 0) {
    return {
      ok: false,
      detail: `--help: expected exit 0, got ${result.status}\nstderr:\n${result.stderr}`,
    };
  }
  if (!/Usage: lint-js/.test(result.stdout)) {
    return {
      ok: false,
      detail: `--help: stdout missing /Usage: lint-js/\nstdout:\n${result.stdout}`,
    };
  }
  return { ok: true, detail: "" };
}

/**
 * Run `--check` against the `basic` fixture from `dist/cli.js`.
 *
 * `basic` is intentionally dirty, so a successful end-to-end run reports findings and exits 1.
 * Exit 1 therefore proves the full pipeline reached the underlying tools.
 * Exit 2 would mean a `LintJsError` aborted the run before findings were produced.
 */
function smokeCheckOnBasic(distCli: string): SmokeResult {
  const dir = mkdtempSync(join(tmpdir(), "lint-js-smoke-basic-"));
  try {
    cpSync(join(fixtureRoot, "basic"), dir, { recursive: true });
    const result = spawnSync(process.execPath, [distCli, "--check"], {
      cwd: dir,
      encoding: "utf8",
    });
    if (result.status !== 1) {
      return {
        ok: false,
        detail:
          `--check on basic fixture: expected exit 1, got ${result.status}\n` +
          `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      };
    }
    return { ok: true, detail: "" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * Verify every path exported by `package-paths.ts` exists in the published layout.
 *
 * Some entries (e.g. doc paths embedded in diagnostic hints) appear as strings in CLI output
 * without being read at startup, so their absence would slip past the CLI-running smoke stages.
 */
async function smokeShippedPaths(packageRoot: string): Promise<SmokeResult> {
  const url = pathToFileURL(join(packageRoot, "dist", "package-paths.js")).href;
  const mod: unknown = await import(url);
  if (typeof mod !== "object" || mod === null) {
    return { ok: false, detail: "package-paths.js: expected module namespace object" };
  }
  const missing: string[] = [];
  for (const [name, value] of Object.entries(mod)) {
    if (typeof value !== "string") continue;
    if (!existsSync(value)) missing.push(`${name} -> ${value}`);
  }
  if (missing.length > 0) {
    return {
      ok: false,
      detail: `shipped paths missing:\n${missing.map((m) => `  - ${m}`).join("\n")}`,
    };
  }
  return { ok: true, detail: "" };
}

const layout = preparePublishLayout();
try {
  const checks: Array<{ name: string; run: () => SmokeResult | Promise<SmokeResult> }> = [
    { name: "help", run: () => smokeHelp(layout.distCli) },
    { name: "check-basic", run: () => smokeCheckOnBasic(layout.distCli) },
    { name: "shipped-paths", run: () => smokeShippedPaths(layout.packageRoot) },
  ];

  const results = await Promise.all(
    checks.map(async (c) => ({ name: c.name, res: await c.run() })),
  );

  let failed = false;
  for (const { name, res } of results) {
    process.stdout.write(`[smoke:${name}] ${res.ok ? "PASS" : "FAIL"}\n`);
    if (!res.ok) {
      process.stderr.write(`${res.detail}\n`);
      failed = true;
    }
  }

  if (failed) process.exitCode = 1;
} finally {
  layout.dispose();
}
