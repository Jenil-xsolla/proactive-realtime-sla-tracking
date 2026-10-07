import { describe, expect, it } from "vitest";
import type { AlertStateRow } from "@/data";
import { alertsBadge, healthBadge } from "@/app/dashboard/badges";
import type { HealthView } from "@/app/dashboard/model";

function health(overrides: Partial<HealthView> = {}): HealthView {
  return {
    usableCount: 4,
    droppedRows: 2,
    unresolvedPartnerNames: ["x"],
    unmatchedServiceNames: [],
    partnersWithNoRows: ["twitch"],
    reasons: [],
    invalidTerms: [{ partner: "kabam", label: "Kabam", message: "bad" }],
    ingestion: {
      status: "ok",
      failed: { count: 1, rows: [] },
      unresolved: { count: 2, rows: [] },
      withoutMessage: { count: 3, rows: [] },
    },
    ...overrides,
  };
}

function alert(overrides: Partial<AlertStateRow>): AlertStateRow {
  return { partnerSlug: "scopely", scopeId: "payments", period: "2026-09", lastStatus: "breaching", lastAlertedAt: null, alertCount: 1, updatedAt: new Date(0), ...overrides };
}

describe("badges", () => {
  it("sums dropped rows, unresolved names, invalid terms and ingestion counts, and does not count zero coverage", () => {
    expect(healthBadge(health())).toEqual({ count: 2 + 1 + 0 + 1 + 1 + 2 + 3 });
  });

  it("is an error when the health read or the ingestion read failed, and absent for business", () => {
    expect(healthBadge({ status: "error" })).toEqual({ status: "error" });
    expect(healthBadge(health({ ingestion: { status: "error" } }))).toEqual({ status: "error" });
    expect(healthBadge(null)).toBeNull();
  });

  it("counts only active alerts in the selected window", () => {
    const rows = [
      alert({}),
      alert({ scopeId: "login", lastStatus: "heads_up" }),
      alert({ scopeId: "wallet", lastStatus: "quiet" }),
      alert({ scopeId: "old", period: "2026-08" }),
    ];
    expect(alertsBadge(rows, "2026-09")).toEqual({ count: 2 });
    expect(alertsBadge([], "2026-09")).toEqual({ count: 0 });
    expect(alertsBadge({ status: "error" }, "2026-09")).toEqual({ status: "error" });
    expect(alertsBadge(null, "2026-09")).toBeNull();
  });
});
