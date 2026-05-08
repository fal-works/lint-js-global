import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const distCli = join(repoRoot, "dist", "cli.js");
const fixtureRoot = join(repoRoot, "test", "fixtures");

interface SmokeResult {
  ok: boolean;
  detail: string;
}

function smokeHelp(): SmokeResult {
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
function smokeCheckOnBasic(): SmokeResult {
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

const checks = [
  { name: "help", run: smokeHelp },
  { name: "check-basic", run: smokeCheckOnBasic },
];

let failed = false;
for (const check of checks) {
  const res = check.run();
  process.stdout.write(`[smoke:${check.name}] ${res.ok ? "PASS" : "FAIL"}\n`);
  if (!res.ok) {
    process.stderr.write(`${res.detail}\n`);
    failed = true;
  }
}

if (failed) process.exitCode = 1;
