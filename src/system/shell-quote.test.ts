import assert from "node:assert/strict";
import test from "node:test";

import { quoteForBatchDoubleQuoted, quoteForPosixDoubleQuoted } from "./shell-quote.ts";

void test("quoteForPosixDoubleQuoted: escapes characters active inside POSIX double quotes", () => {
  assert.equal(quoteForPosixDoubleQuoted("/plain/path"), '"/plain/path"');
  assert.equal(quoteForPosixDoubleQuoted("/with space/path"), '"/with space/path"');
  assert.equal(quoteForPosixDoubleQuoted("/has$VAR/x"), '"/has\\$VAR/x"');
  assert.equal(quoteForPosixDoubleQuoted("/has`cmd`/x"), '"/has\\`cmd\\`/x"');
  assert.equal(quoteForPosixDoubleQuoted("/has\\backslash"), '"/has\\\\backslash"');
  assert.equal(quoteForPosixDoubleQuoted('/has"quote'), '"/has\\"quote"');
  assert.equal(quoteForPosixDoubleQuoted("/has%percent"), '"/has%percent"');
});

void test("quoteForBatchDoubleQuoted: doubles % so variable substitution does not fire", () => {
  assert.equal(quoteForBatchDoubleQuoted("C:\\plain\\path"), '"C:\\plain\\path"');
  assert.equal(quoteForBatchDoubleQuoted("C:\\with space\\path"), '"C:\\with space\\path"');
  assert.equal(quoteForBatchDoubleQuoted("C:\\has%VAR%\\x"), '"C:\\has%%VAR%%\\x"');
  assert.equal(quoteForBatchDoubleQuoted("C:\\has$VAR\\x"), '"C:\\has$VAR\\x"');
});
