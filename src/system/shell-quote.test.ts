import assert from "node:assert/strict";
import test from "node:test";

import { quotePathForBatchDoubleQuoted, quotePathForPosixDoubleQuoted } from "./shell-quote.ts";

void test("quotePathForPosixDoubleQuoted: escapes characters active inside POSIX double quotes", () => {
  assert.equal(quotePathForPosixDoubleQuoted("/plain/path"), '"/plain/path"');
  assert.equal(quotePathForPosixDoubleQuoted("/with space/path"), '"/with space/path"');
  assert.equal(quotePathForPosixDoubleQuoted("/has$VAR/x"), '"/has\\$VAR/x"');
  assert.equal(quotePathForPosixDoubleQuoted("/has`cmd`/x"), '"/has\\`cmd\\`/x"');
  assert.equal(quotePathForPosixDoubleQuoted("/has\\backslash"), '"/has\\\\backslash"');
  assert.equal(quotePathForPosixDoubleQuoted('/has"quote'), '"/has\\"quote"');
  assert.equal(quotePathForPosixDoubleQuoted("/has%percent"), '"/has%percent"');
});

void test("quotePathForBatchDoubleQuoted: doubles % so variable substitution does not fire", () => {
  assert.equal(quotePathForBatchDoubleQuoted("C:\\plain\\path"), '"C:\\plain\\path"');
  assert.equal(quotePathForBatchDoubleQuoted("C:\\with space\\path"), '"C:\\with space\\path"');
  assert.equal(quotePathForBatchDoubleQuoted("C:\\has%VAR%\\x"), '"C:\\has%%VAR%%\\x"');
  assert.equal(quotePathForBatchDoubleQuoted("C:\\has$VAR\\x"), '"C:\\has$VAR\\x"');
});
