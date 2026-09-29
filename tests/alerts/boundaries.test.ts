import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

function typescriptFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return typescriptFiles(full);
    }
    return full.endsWith(".ts") ? [full] : [];
  });
}

describe("alert module boundaries", () => {
  it("keeps Slack and the engine out of the client bundle path", () => {
    const alertsDir = path.join(process.cwd(), "src/alerts");
    const sources = typescriptFiles(alertsDir).map((file) => readFileSync(file, "utf8"));
    expect(sources.length).toBeGreaterThan(0);
    for (const source of sources) {
      expect(source).not.toContain("NEXT_PUBLIC_");
      expect(source).not.toContain("@/engine");
    }
    expect(sources.join("\n")).toContain("SLACK_BOT_TOKEN");
    expect(sources.join("\n")).toContain('from "@/slack/client"');
    expect(sources.join("\n")).toContain('method: "chat.postMessage"');

    const clientSource = readFileSync(path.join(process.cwd(), "src/slack/client.ts"), "utf8");
    expect(clientSource).toContain('const SLACK_API_BASE = "https://slack.com/api"');

    const state = readFileSync(path.join(alertsDir, "state.ts"), "utf8");
    expect(state).toContain("pg_advisory_xact_lock");
    expect(state).toContain("lastStatus");
    expect(state).not.toContain("slaOutages");
  });
});
