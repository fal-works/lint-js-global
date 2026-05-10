import assert from "node:assert/strict";
import test from "node:test";

import {
  HINT_PATH,
  joinSections,
  makeFileFinding,
  makeProjectFinding,
} from "../../../test/lint-diagnostics-helpers.ts";
import { renderFindings } from "./compose.ts";

void test("renderFindings: stylish mode, single file finding, populates fileBlock and summaryLine", () => {
  const result = renderFindings(
    { file: [makeFileFinding({ filename: "/x.ts", message: "boom" })], project: [] },
    { outputMode: "stylish", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.equal(
    result.fileBlock,
    joinSections([["/x.ts", "  1:1 boom [eslint(no-debugger)]", "    debugger"]]),
  );
  assert.equal(result.projectBlock, "");
  assert.equal(result.weakTypingsHint, "");
  assert.equal(result.summaryLine, "1 unfixed lint issue.");
});

void test("renderFindings: unix mode emits one flat line per finding in fileBlock", () => {
  const result = renderFindings(
    {
      file: [
        makeFileFinding({
          filename: "/x.ts",
          message: "`debugger` statement is not allowed.",
          code: "eslint(no-debugger)",
        }),
      ],
      project: [],
    },
    { outputMode: "unix", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.equal(
    result.fileBlock,
    "/x.ts:1:1: `debugger` statement is not allowed. [eslint(no-debugger)]\n",
  );
  assert.equal(result.projectBlock, "");
  assert.equal(result.weakTypingsHint, "");
  assert.equal(result.summaryLine, "1 unfixed lint issue.");
});

void test("renderFindings: a no-unsafe-* finding surfaces the weak-typings hint block (stylish mode)", () => {
  const result = renderFindings(
    {
      file: [
        makeFileFinding({
          code: "typescript-eslint(no-unsafe-member-access)",
          message: "Unsafe member access .foo on an `any` value.",
        }),
      ],
      project: [],
    },
    { outputMode: "stylish", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.match(result.fileBlock, /no-unsafe-member-access/);
  assert.ok(!result.fileBlock.includes("Hint on the"));
  assert.match(result.weakTypingsHint, /^Hint on the `no-unsafe-\*` diagnostics:/);
  assert.match(result.weakTypingsHint, new RegExp(`- See: ${HINT_PATH}\\n$`));
  assert.equal(result.summaryLine, "1 unfixed lint issue.");
});

void test("renderFindings: a no-unsafe-* finding surfaces the weak-typings hint under unix mode too", () => {
  // Hint and summary are mode-independent.
  const result = renderFindings(
    {
      file: [
        makeFileFinding({
          code: "typescript-eslint(no-unsafe-member-access)",
          message: "Unsafe member access .foo on an `any` value.",
        }),
      ],
      project: [],
    },
    { outputMode: "unix", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.match(result.weakTypingsHint, /^Hint on the `no-unsafe-\*` diagnostics:/);
  assert.equal(result.summaryLine, "1 unfixed lint issue.");
});

void test("renderFindings: null code never trips the weak-typings hint", () => {
  // The unsafe-pattern matcher must guard against null code; a parse-error finding has no code
  // and must not be treated as an unsafe-* match.
  const result = renderFindings(
    {
      file: [makeFileFinding({ code: null, message: "Unexpected token." })],
      project: [],
    },
    { outputMode: "stylish", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.equal(result.weakTypingsHint, "");
});

void test("renderFindings: project-only payload populates projectBlock and leaves fileBlock empty (stylish mode)", () => {
  const result = renderFindings(
    {
      file: [],
      project: [
        makeProjectFinding({
          filename: "tsconfig.json",
          code: "typescript(tsconfig-error)",
          message: "Cannot find type definition file for 'node'.",
        }),
      ],
    },
    { outputMode: "stylish", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.equal(result.fileBlock, "");
  assert.equal(
    result.projectBlock,
    "tsconfig.json\n  Cannot find type definition file for 'node'. [typescript(tsconfig-error)]\n",
  );
  assert.equal(result.weakTypingsHint, "");
  assert.equal(result.summaryLine, "1 unfixed lint issue.");
});

void test("renderFindings: project-only payload populates projectBlock under unix mode too", () => {
  const result = renderFindings(
    {
      file: [],
      project: [
        makeProjectFinding({
          filename: "tsconfig.json",
          code: "typescript(tsconfig-error)",
          message: "msg",
        }),
      ],
    },
    { outputMode: "unix", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.equal(result.fileBlock, "");
  assert.equal(result.projectBlock, "tsconfig.json: msg [typescript(tsconfig-error)]\n");
  assert.equal(result.summaryLine, "1 unfixed lint issue.");
});

void test("renderFindings: empty filename in a project finding surfaces the (project) placeholder", () => {
  const result = renderFindings(
    {
      file: [],
      project: [
        makeProjectFinding({
          filename: "",
          code: "typescript(tsconfig-error)",
          message: "Cannot find type definition file for 'node'.",
        }),
      ],
    },
    { outputMode: "stylish", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.equal(result.fileBlock, "");
  assert.equal(
    result.projectBlock,
    "(project)\n  Cannot find type definition file for 'node'. [typescript(tsconfig-error)]\n",
  );
});

void test("renderFindings: null code renders as parse-error inside [...] in the file block (stylish mode)", () => {
  const result = renderFindings(
    {
      file: [
        makeFileFinding({
          filename: "/x.ts",
          code: null,
          message: "Unexpected token.",
          startLine: 1,
          startCol: 11,
          endLine: 1,
          endCol: 11,
          spanText: ";",
        }),
      ],
      project: [],
    },
    { outputMode: "stylish", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.match(result.fileBlock, /\[parse-error\]/);
  assert.equal(result.summaryLine, "1 unfixed lint issue.");
});

void test("renderFindings: null code renders as parse-error in unix mode too", () => {
  const result = renderFindings(
    {
      file: [
        makeFileFinding({
          filename: "/x.ts",
          code: null,
          message: "Unexpected token.",
          startLine: 1,
          startCol: 11,
          endLine: 1,
          endCol: 11,
          spanText: ";",
        }),
      ],
      project: [],
    },
    { outputMode: "unix", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.equal(result.fileBlock, "/x.ts:1:11: Unexpected token. [parse-error]\n");
  assert.equal(result.summaryLine, "1 unfixed lint issue.");
});

void test("renderFindings: mixed payload populates both blocks and counts every finding in the summary", () => {
  const result = renderFindings(
    {
      file: [makeFileFinding({ filename: "/x.ts", message: "boom" })],
      project: [
        makeProjectFinding({
          filename: "tsconfig.json",
          code: "typescript(tsconfig-error)",
          message: "Cannot find type definition file for 'node'.",
        }),
      ],
    },
    { outputMode: "stylish", check: false, weakTypingsDocPath: HINT_PATH },
  );

  assert.equal(
    result.fileBlock,
    joinSections([["/x.ts", "  1:1 boom [eslint(no-debugger)]", "    debugger"]]),
  );
  assert.equal(
    result.projectBlock,
    "tsconfig.json\n  Cannot find type definition file for 'node'. [typescript(tsconfig-error)]\n",
  );
  assert.equal(result.summaryLine, "2 unfixed lint issues.");
});

void test("renderFindings: --check mode drops the 'unfixed' qualifier in the summaryLine (singular)", () => {
  const result = renderFindings(
    { file: [makeFileFinding()], project: [] },
    { outputMode: "stylish", check: true, weakTypingsDocPath: HINT_PATH },
  );
  assert.equal(result.summaryLine, "1 lint issue.");
});

void test("renderFindings: --check mode drops the 'unfixed' qualifier in the summaryLine (plural)", () => {
  const result = renderFindings(
    {
      file: [makeFileFinding({ filename: "/x.ts" }), makeFileFinding({ filename: "/y.ts" })],
      project: [],
    },
    { outputMode: "stylish", check: true, weakTypingsDocPath: HINT_PATH },
  );
  assert.equal(result.summaryLine, "2 lint issues.");
});
