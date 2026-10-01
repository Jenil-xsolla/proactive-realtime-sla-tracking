import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const ENGINE_MESSAGE =
  "src/engine is pure and cannot import framework or database modules.";

const RELATIVE_ESCAPE_MESSAGE =
  "Relative imports must not escape src/engine.";

const ALIAS_MESSAGE =
  "src/engine cannot import the rest of the app through the @/ alias.";

function restrictedImports(depth) {
  const relativeEscape =
    depth === 0
      ? String.raw`^\.\.(?:\/|$)`
      : `^(?:\\.\\.\\/){${depth + 1}}`;

  return {
    "no-restricted-imports": [
      "error",
      {
        paths: [
          { name: "react", message: ENGINE_MESSAGE },
          { name: "next", message: ENGINE_MESSAGE },
          { name: "drizzle-orm", message: ENGINE_MESSAGE },
          { name: "pg", message: ENGINE_MESSAGE },
        ],
        patterns: [
          {
            regex: "^(?:react|next|drizzle-orm|pg)\\/.+",
            message: ENGINE_MESSAGE,
            caseSensitive: true,
          },
          {
            regex: "^@/",
            message: ALIAS_MESSAGE,
            caseSensitive: true,
          },
          {
            regex: relativeEscape,
            message: RELATIVE_ESCAPE_MESSAGE,
            caseSensitive: true,
          },
        ],
      },
    ],
  };
}

const engineGlobs = [
  "src/engine/*.{js,jsx,ts,tsx,mjs,cjs}",
  "src/engine/*/*.{js,jsx,ts,tsx,mjs,cjs}",
  "src/engine/*/*/*.{js,jsx,ts,tsx,mjs,cjs}",
  "src/engine/*/*/*/*.{js,jsx,ts,tsx,mjs,cjs}",
  "src/engine/*/*/*/*/*.{js,jsx,ts,tsx,mjs,cjs}",
  "src/engine/*/*/*/*/*/*.{js,jsx,ts,tsx,mjs,cjs}",
];

const BACKTEST_PATTERNS = [
  {
    regex: "(?:^|/)alerts(?:/|$)",
    message:
      "The backtest imports the engine directly and cannot import the alerting module.",
    caseSensitive: true,
  },
  {
    regex: "slack",
    message: "The backtest cannot import a Slack client.",
    caseSensitive: false,
  },
];

const INGESTION_WRITER_DB_MESSAGE =
  "Only src/ingestion/** may import writer.ts or the ingestion database client.";

// Blocks the alias form (@/ingestion/writer, @/ingestion/db, with or without
// the .ts extension) and any relative path that resolves into ingestion's
// writer or db module (e.g. ../ingestion/writer, ../../ingestion/db).
const INGESTION_WRITER_DB_PATTERN = {
  regex: "(^|/)ingestion/(writer|db)(\\.ts)?$",
  message: INGESTION_WRITER_DB_MESSAGE,
  caseSensitive: true,
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  ...engineGlobs.map((files, depth) => ({
    files: [files],
    rules: restrictedImports(depth),
  })),
  {
    files: ["scripts/backtest.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          // Merges the backtest's own restrictions with the ingestion
          // writer/db boundary: flat-config no-restricted-imports entries
          // for the same file don't merge across config objects, so
          // scripts/backtest.ts (matched by the src/**+scripts/** block
          // below too) needs every applicable pattern listed here once.
          patterns: [...BACKTEST_PATTERNS, INGESTION_WRITER_DB_PATTERN],
        },
      ],
    },
  },
  {
    // Only src/ingestion/** may import writer.ts or db.ts. tests/** is
    // allowed here too (it's outside this block's `files`), because
    // tests/ingestion/** legitimately imports the writer/db to test them
    // directly, and there's no separate boundary concern for tests/**.
    // src/engine/** and scripts/backtest.ts are excluded via `ignores` so
    // this block never overrides their own no-restricted-imports rule
    // (see the comment above) — flat config replaces, it doesn't merge,
    // rules for the same file across config objects.
    files: ["src/**/*.{js,jsx,ts,tsx,mjs,cjs}", "scripts/**/*.{js,jsx,ts,tsx,mjs,cjs}"],
    ignores: ["src/ingestion/**", ...engineGlobs, "scripts/backtest.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [
            { name: "@/ingestion/writer", message: INGESTION_WRITER_DB_MESSAGE },
            { name: "@/ingestion/writer.ts", message: INGESTION_WRITER_DB_MESSAGE },
            { name: "@/ingestion/db", message: INGESTION_WRITER_DB_MESSAGE },
            { name: "@/ingestion/db.ts", message: INGESTION_WRITER_DB_MESSAGE },
          ],
          patterns: [INGESTION_WRITER_DB_PATTERN],
        },
      ],
    },
  },
]);

export default eslintConfig;
