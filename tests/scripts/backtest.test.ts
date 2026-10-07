import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DATA_COVERAGE_START, WINDOW_TIMEZONE, type EngineTerms, type PartnerScopes, type UsableOutage } from "@/engine";
import type { PartnerId, ServiceId } from "@/registry";
import {
  backtest,
  formatBacktestTable,
  serializeBacktest,
  writeBacktestFile,
} from "../../scripts/backtest";

function terms(
  effectiveFrom: string,
  effectiveTo: string | null = null,
  overrides: Partial<EngineTerms> = {},
): EngineTerms {
  return {
    target: 0.999,
    window: "calendar_month",
    timezone: WINDOW_TIMEZONE,
    effectiveFrom: new Date(effectiveFrom),
    effectiveTo: effectiveTo === null ? null : new Date(effectiveTo),
    penaltyKind: "tiers",
    penaltyTiers: [{ belowAvailability: 0.999, creditFraction: 0.1 }],
    perScopeCap: null,
    contractAggregateCap: null,
    monthlyFee: null,
    ...overrides,
  };
}

function payments(
  scopeId: string,
  effectiveFrom: string,
  effectiveTo: string | null = null,
  overrides: Partial<EngineTerms> = {},
) {
  return {
    kind: "service" as const,
    scopeId,
    services: ["payments"] as const,
    terms: terms(effectiveFrom, effectiveTo, overrides),
  };
}

function outage(
  partnerId: PartnerId,
  pirKey: string,
  incidentStarted: string,
  outageMinutes: number,
): UsableOutage<PartnerId, ServiceId> {
  return {
    pirKey,
    partnerId,
    serviceId: "payments",
    incidentStarted: new Date(incidentStarted),
    outageMinutes,
  };
}

function partner(
  id: PartnerId,
  scopes: PartnerScopes<PartnerId, ServiceId>["scopes"],
): PartnerScopes<PartnerId, ServiceId> {
  return { partner: id, scopes };
}

describe("backtest", () => {
  it("counts no January or February exposure when terms commence in March", () => {
    const report = backtest({
      outages: [
        outage("scopely", "PIR-JAN", "2026-01-10T00:00:00.000Z", 1000),
        outage("scopely", "PIR-FEB", "2026-02-10T00:00:00.000Z", 1000),
        outage("scopely", "PIR-MAR", "2026-03-10T00:00:00.000Z", 1000),
      ],
      scopes: [partner("scopely", [payments("payments-sla", "2026-03-01T00:00:00.000Z")])],
      through: new Date("2026-04-01T00:00:00.000Z"),
    });

    expect(report.range).toEqual({
      description: "as far back as data exists",
      from: DATA_COVERAGE_START,
      through: "2026-03-31",
    });
    expect(JSON.stringify(report).toLowerCase()).not.toContain("twelve");
    expect(JSON.stringify(report)).not.toMatch(/12-month|12 month/i);

    const months = report.partners[0]?.months ?? [];
    const january = months.find((month) => month.month === "2026-01");
    const february = months.find((month) => month.month === "2026-02");
    const march = months.find((month) => month.month === "2026-03");

    expect(january).toMatchObject({ exposure: false, days: 31, scopes: [] });
    expect(february).toMatchObject({ exposure: false, days: 28, scopes: [] });
    expect(march?.exposure).toBe(true);
    expect(march?.scopes[0]?.rules.breaching).toBeGreaterThan(0);
    expect(january && "rules" in january).toBe(false);
    expect(february && "rules" in february).toBe(false);

    const table = formatBacktestTable(report);
    expect(table).toMatch(/scopely\s+2026-01\s+no exposure/);
    expect(table).toMatch(/scopely\s+2026-02\s+no exposure/);
    expect(table.toLowerCase()).not.toContain("twelve");
  });

  it("leaves the days before a mid-March commencement unscored", () => {
    const report = backtest({
      outages: [outage("scopely", "PIR-EARLY", "2026-03-01T00:00:00.000Z", 1000)],
      scopes: [partner("scopely", [payments("payments-sla", "2026-03-15T00:00:00.000Z")])],
      through: new Date("2026-04-01T00:00:00.000Z"),
    });

    const march = report.partners[0]?.months.find((month) => month.month === "2026-03");
    expect(march).toMatchObject({
      exposure: true,
      days: 31,
      scopes: [
        {
          scopeId: "payments-sla",
          steps: 17,
          rules: { breaching: 0, trend: 0, level: 0, meeting: 17 },
        },
      ],
    });
    expect(report.partners[0]?.months.find((month) => month.month === "2026-01")?.exposure).toBe(false);
    expect(report.partners[0]?.months.find((month) => month.month === "2026-02")?.exposure).toBe(false);
  });

  it("counts each status rule on the days it fired", () => {
    const report = backtest({
      outages: [outage("scopely", "PIR-LEVEL", "2026-01-01T00:00:00.000Z", 40)],
      scopes: [partner("scopely", [payments("payments-sla", "2026-01-01T00:00:00.000Z")])],
      through: new Date("2026-02-01T00:00:00.000Z"),
    });

    expect(report.partners).toHaveLength(1);
    expect(report.partners[0]?.months).toEqual([
      {
        month: "2026-01",
        days: 31,
        exposure: true,
        scopes: [
          {
            scopeId: "payments-sla",
            steps: 31,
            rules: { breaching: 0, trend: 21, level: 31, meeting: 0 },
          },
        ],
      },
    ]);
    expect(report.constants).toEqual({
      MIN_ELAPSED: 0.2,
      MIN_CONSUMPTION: 0.5,
      HIGH_CONSUMPTION: 0.75,
    });
  });

  it("counts breaching on every day the allowance is already exhausted", () => {
    const report = backtest({
      outages: [outage("scopely", "PIR-BREACH", "2026-01-01T00:00:00.000Z", 100)],
      scopes: [partner("scopely", [payments("payments-sla", "2026-01-01T00:00:00.000Z")])],
      through: new Date("2026-01-04T00:00:00.000Z"),
    });

    expect(report.range.through).toBe("2026-01-03");
    expect(report.partners[0]?.months[0]?.scopes[0]?.rules).toEqual({
      breaching: 3,
      trend: 0,
      level: 0,
      meeting: 0,
    });
  });

  it("limits the replay to one partner", () => {
    const report = backtest({
      outages: [
        outage("scopely", "PIR-SCOPELY", "2026-01-01T00:00:00.000Z", 1000),
        outage("niantic", "PIR-NIANTIC", "2026-01-01T00:00:00.000Z", 1),
      ],
      scopes: [
        partner("scopely", [payments("scopely-payments", "2026-01-01T00:00:00.000Z")]),
        partner("niantic", [payments("niantic-payments", "2026-01-01T00:00:00.000Z")]),
      ],
      partner: "niantic",
      through: new Date("2026-01-03T00:00:00.000Z"),
    });

    expect(report.partner).toBe("niantic");
    expect(report.partners.map((entry) => entry.partner)).toEqual(["niantic"]);
    expect(report.partners[0]?.months[0]?.scopes[0]).toMatchObject({
      scopeId: "niantic-payments",
      rules: { breaching: 0, trend: 0, level: 0, meeting: 2 },
    });
  });

  it("rejects a partner that is not in the registry", () => {
    expect(() =>
      backtest({
        outages: [],
        scopes: [],
        partner: "not-a-partner",
        through: new Date("2026-02-01T00:00:00.000Z"),
      }),
    ).toThrow(/Unknown partner/);
  });

  it("prints a summary table and writes the same report as JSON", () => {
    const report = backtest({
      outages: [outage("scopely", "PIR-BREACH", "2026-01-01T00:00:00.000Z", 100)],
      scopes: [partner("scopely", [payments("payments-sla", "2026-01-01T00:00:00.000Z")])],
      through: new Date("2026-01-04T00:00:00.000Z"),
    });

    const table = formatBacktestTable(report);
    expect(table.startsWith("as far back as data exists\n")).toBe(true);
    expect(table).toContain("2026-01-01 through 2026-01-03");
    expect(table).toContain("MIN_ELAPSED");
    expect(table).toContain("MIN_CONSUMPTION");
    expect(table).toContain("HIGH_CONSUMPTION");
    expect(table).toMatch(/scopely\s+2026-01\s+payments-sla\s+3\s+3\s+0\s+0\s+0/);
    expect(table.toLowerCase()).not.toContain("twelve");
    expect(table).not.toMatch(/12-month|12 month/i);

    const parsed = JSON.parse(serializeBacktest(report)) as unknown;
    expect(parsed).toEqual(report);

    const directory = mkdtempSync(path.join(tmpdir(), "sla-backtest-"));
    try {
      const file = path.join(directory, "backtest.json");
      writeBacktestFile(report, file);
      expect(JSON.parse(readFileSync(file, "utf8"))).toEqual(report);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("evaluates every day of January 2026 when the contract started in 2023", () => {
    const report = backtest({
      outages: [outage("scopely", "PIR-JAN", "2026-01-10T00:00:00.000Z", 22)],
      scopes: [
        partner("scopely", [
          payments("payments-sla", "2023-03-27T00:00:00.000Z", null, { target: 0.9995 }),
        ]),
      ],
      through: new Date("2026-02-01T00:00:00.000Z"),
    });

    expect(report.partners[0]?.months.find((month) => month.month === "2026-01")).toMatchObject({
      exposure: true,
      days: 31,
      scopes: [{ scopeId: "payments-sla", steps: 31, rules: { breaching: 0 } }],
    });
  });

  it("prorates a mid-month effective date when it replays that month", () => {
    const report = backtest({
      outages: [outage("scopely", "PIR-JUNE", "2027-06-20T00:00:00.000Z", 15)],
      scopes: [
        partner("scopely", [
          payments("payments-sla", "2027-06-15T00:00:00.000Z", null, { target: 0.9995 }),
        ]),
      ],
      through: new Date("2027-07-01T00:00:00.000Z"),
    });

    const june = report.partners[0]?.months.find((month) => month.month === "2027-06");
    expect(june).toMatchObject({
      exposure: true,
      days: 30,
      scopes: [
        {
          scopeId: "payments-sla",
          steps: 16,
          rules: { breaching: 11, trend: 0, level: 0, meeting: 5 },
        },
      ],
    });
  });

  it("has no import path to alerts or a Slack client", () => {
    const source = readFileSync(path.join(process.cwd(), "scripts/backtest.ts"), "utf8");
    const imports = source
      .split("\n")
      .filter((line) => /^\s*import\b/.test(line) || /\brequire\(/.test(line));
    expect(imports.join("\n")).not.toMatch(/alerts|slack/i);
    expect(source).not.toMatch(/dry-?run/i);
    expect(source.toLowerCase()).not.toContain("twelve");
  });
});
