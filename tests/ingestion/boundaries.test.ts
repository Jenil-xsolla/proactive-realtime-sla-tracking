import { readFileSync } from "node:fs";
import path from "node:path";
import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

const RULE_ID = "no-restricted-imports";

function restrictedImportErrors(messages: Array<{ ruleId: string | null }>) {
  return messages.filter((message) => message.ruleId === RULE_ID);
}

describe("ingestion writer/db import boundary", () => {
  const eslint = new ESLint({ cwd: process.cwd() });

  it("blocks the alias import of writer.ts from outside src/ingestion", async () => {
    const results = await eslint.lintText(
      `import { captureRows } from "@/ingestion/writer";\ncaptureRows;\n`,
      { filePath: "src/feed/x.ts" },
    );
    expect(restrictedImportErrors(results[0].messages).length).toBeGreaterThan(0);
  }, 20000);

  it("blocks the alias import of db.ts from an API route", async () => {
    const results = await eslint.lintText(
      `import { getIngestionDatabase } from "@/ingestion/db";\ngetIngestionDatabase;\n`,
      { filePath: "src/app/api/x/route.ts" },
    );
    expect(restrictedImportErrors(results[0].messages).length).toBeGreaterThan(0);
  }, 20000);

  it("blocks a relative import into writer.ts", async () => {
    const results = await eslint.lintText(
      `import { captureRows } from "../ingestion/writer";\ncaptureRows;\n`,
      { filePath: "src/data/x.ts" },
    );
    expect(restrictedImportErrors(results[0].messages).length).toBeGreaterThan(0);
  }, 20000);

  it("blocks the writer import from scripts/**", async () => {
    const results = await eslint.lintText(
      `import { captureRows } from "@/ingestion/writer";\ncaptureRows;\n`,
      { filePath: "scripts/x.ts" },
    );
    expect(restrictedImportErrors(results[0].messages).length).toBeGreaterThan(0);
  }, 20000);

  it("allows the same import from inside src/ingestion/**", async () => {
    const results = await eslint.lintText(
      `import { captureRows } from "@/ingestion/writer";\ncaptureRows;\n`,
      { filePath: "src/ingestion/notify/x.ts" },
    );
    expect(restrictedImportErrors(results[0].messages).length).toBe(0);
  }, 20000);

  it("allows the writer import from tests/ingestion/**", async () => {
    const results = await eslint.lintText(
      `import { captureRows } from "@/ingestion/writer";\ncaptureRows;\n`,
      { filePath: "tests/ingestion/x.test.ts" },
    );
    expect(restrictedImportErrors(results[0].messages).length).toBe(0);
  }, 20000);

  it("allows importing the public entry point from outside ingestion", async () => {
    const results = await eslint.lintText(
      `import { readPir } from "@/ingestion";\nreadPir;\n`,
      { filePath: "src/app/x.ts" },
    );
    expect(restrictedImportErrors(results[0].messages).length).toBe(0);
  }, 20000);

  it("REGRESSION: still blocks React inside src/engine (engine purity)", async () => {
    const results = await eslint.lintText(
      `import React from "react";\nReact;\n`,
      { filePath: "src/engine/x.ts" },
    );
    expect(restrictedImportErrors(results[0].messages).length).toBeGreaterThan(0);
  }, 20000);

  it("REGRESSION: still blocks an alerts import inside scripts/backtest.ts", async () => {
    const results = await eslint.lintText(
      `import { runAlerts } from "../src/alerts";\nrunAlerts;\n`,
      { filePath: "scripts/backtest.ts" },
    );
    expect(restrictedImportErrors(results[0].messages).length).toBeGreaterThan(0);
  }, 20000);

  it("src/ingestion/index.ts does not re-export writer or db", () => {
    const source = readFileSync(
      path.join(process.cwd(), "src/ingestion/index.ts"),
      "utf8",
    );
    expect(source).not.toContain("writer");
    expect(source).not.toContain("./db");
  });
});
