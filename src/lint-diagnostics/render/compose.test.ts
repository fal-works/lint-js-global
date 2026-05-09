import assert from "node:assert/strict";
import test from "node:test";

import {
  HINT_PATH,
  joinSections,
  makeProject,
  makeResolved,
} from "../../../test/lint-diagnostics-helpers.ts";
import { renderLintFindings } from "./compose.ts";

void test("renderLintFindings: stylish mode, single file diagnostic, populates fileBlock and summaryLine", () => {
  const result = renderLintFindings(
    { file: [makeResolved({ filename: "/x.ts", message: "boom" })], project: [] },
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

void test("renderLintFindings: unix mode emits one flat line per diagnostic in fileBlock", () => {
  const result = renderLintFindings(
    {
      file: [
        makeResolved({
          filename: "/x.ts",
          message: "`debugger` statement is not allowed.",
          errorCode: "eslint(no-debugger)",
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

void test("renderLintFindings: a no-unsafe-* diagnostic surfaces the weak-typings hint block (stylish mode)", () => {
  const result = renderLintFindings(
    {
      file: [
        makeResolved({
          errorCode: "typescript-eslint(no-unsafe-member-access)",
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

void test("renderLintFindings: a no-unsafe-* diagnostic surfaces the weak-typings hint under unix mode too", () => {
  // Hint and summary are mode-independent.
  const result = renderLintFindings(
    {
      file: [
        makeResolved({
          errorCode: "typescript-eslint(no-unsafe-member-access)",
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

void test("renderLintFindings: project-only payload populates projectBlock and leaves fileBlock empty (stylish mode)", () => {
  const result = renderLintFindings(
    {
      file: [],
      project: [
        makeProject({
          filename: "tsconfig.json",
          errorCode: "typescript(tsconfig-error)",
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

void test("renderLintFindings: project-only payload populates projectBlock under unix mode too", () => {
  const result = renderLintFindings(
    {
      file: [],
      project: [
        makeProject({
          filename: "tsconfig.json",
          errorCode: "typescript(tsconfig-error)",
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

void test("renderLintFindings: empty filename in a project diagnostic surfaces the (project) placeholder", () => {
  const result = renderLintFindings(
    {
      file: [],
      project: [
        makeProject({
          filename: "",
          errorCode: "typescript(tsconfig-error)",
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

void test("renderLintFindings: oxc parse-error placeholder renders inside [...] in the file block (stylish mode)", () => {
  const result = renderLintFindings(
    {
      file: [
        makeResolved({
          filename: "/x.ts",
          errorCode: "parse-error",
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

void test("renderLintFindings: oxc parse-error placeholder renders in unix mode too", () => {
  const result = renderLintFindings(
    {
      file: [
        makeResolved({
          filename: "/x.ts",
          errorCode: "parse-error",
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

void test("renderLintFindings: mixed payload populates both blocks and counts every diagnostic in the summary", () => {
  const result = renderLintFindings(
    {
      file: [makeResolved({ filename: "/x.ts", message: "boom" })],
      project: [
        makeProject({
          filename: "tsconfig.json",
          errorCode: "typescript(tsconfig-error)",
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

void test("renderLintFindings: --check mode drops the 'unfixed' qualifier in the summaryLine (singular)", () => {
  const result = renderLintFindings(
    { file: [makeResolved()], project: [] },
    { outputMode: "stylish", check: true, weakTypingsDocPath: HINT_PATH },
  );
  assert.equal(result.summaryLine, "1 lint issue.");
});

void test("renderLintFindings: --check mode drops the 'unfixed' qualifier in the summaryLine (plural)", () => {
  const result = renderLintFindings(
    {
      file: [makeResolved({ filename: "/x.ts" }), makeResolved({ filename: "/y.ts" })],
      project: [],
    },
    { outputMode: "stylish", check: true, weakTypingsDocPath: HINT_PATH },
  );
  assert.equal(result.summaryLine, "2 lint issues.");
});
