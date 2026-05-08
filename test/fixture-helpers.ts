import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixtureRoot = join(here, "fixtures");

/** Fixture source with both fmt (double spaces) and lint (no-debugger) violations. */
export const DIRTY_SOURCE = "const x  =  1;debugger\n";

export function makeTempDir(label: string): string {
  return mkdtempSync(join(tmpdir(), `lint-js-test-${label}-`));
}

/**
 * Copy a fixture under `test/fixtures/` to a fresh temp directory.
 *
 * @returns Path to the copied directory.
 */
export function copyFixture(fixtureName: string): string {
  const dest = makeTempDir(fixtureName);
  cpSync(join(fixtureRoot, fixtureName), dest, { recursive: true });
  return dest;
}

/** Write a matching pattern into both `.prettierignore` and `.eslintignore` at `dir`. */
export function writeIgnoreFiles(dir: string, pattern: string): void {
  writeFileSync(join(dir, ".prettierignore"), `${pattern}\n`);
  writeFileSync(join(dir, ".eslintignore"), `${pattern}\n`);
}
