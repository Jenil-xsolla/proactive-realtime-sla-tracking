import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNUSABLE_REASONS } from "@/data";
import type { AlertStateRow } from "@/data";
import type { SlaFeed } from "@/feed";
import { QUERY_FAILED, VIEWER_UNCONFIGURED } from "@/app/dashboard/copy";
import { businessScoredRow, scoredRow } from "../support/rows";

const mocks = vi.hoisted(() => ({
  getSlaFeed: vi.fn(),
  getSlaHealth: vi.fn(),
  getViewer: vi.fn(),
  listAlertState: vi.fn(),
  readContractTerms: vi.fn(),
}));

vi.mock("next/cache", () => ({ unstable_noStore: () => undefined }));
vi.mock("@/feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/feed")>()),
  getSlaFeed: mocks.getSlaFeed,
  getSlaHealth: mocks.getSlaHealth,
  getViewer: mocks.getViewer,
}));
vi.mock("@/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/data")>()),
  getDatabase: () => ({}),
  listAlertState: mocks.listAlertState,
  readContractTerms: mocks.readContractTerms,
}));

const { loadWorkspace } = await import("@/app/dashboard/load");

const outageHealth: SlaFeed["health"] = {
  usableCount: 1,
  unusableCount: 0,
  countsByReason: Object.fromEntries(UNUSABLE_REASONS.map((reason) => [reason, 0])) as SlaFeed["health"]["countsByReason"],
  unresolvedPartnerNames: [],
  unresolvedServiceNames: [],
  partnersWithZeroAttributedRows: [],
};

function technicalFeed(): SlaFeed {
  return {
    asOf: "2026-10-07T12:00:00.000Z",
    health: outageHealth,
    role: "technical",
    rows: [scoredRow()],
    ingestion: { status: "ok", counts: { failed: 0, unresolved: 0, withoutMessage: 0 }, failed: [], unresolved: [], withoutMessage: [] },
    invalidTerms: [],
  };
}

function businessFeed(): SlaFeed {
  return {
    asOf: "2026-10-07T12:00:00.000Z",
    health: outageHealth,
    role: "business",
    rows: [businessScoredRow()],
    ingestion: { status: "ok", counts: { failed: 0, unresolved: 0, withoutMessage: 0 } },
  };
}

const alertRow: AlertStateRow = {
  partnerSlug: "scopely",
  scopeId: "payments",
  period: "2026-10",
  lastStatus: "breaching",
  lastAlertedAt: null,
  alertCount: 1,
  updatedAt: new Date(0),
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  mocks.getViewer.mockReturnValue({ role: "technical" });
  mocks.getSlaHealth.mockResolvedValue({ role: "technical", unusable: [] });
  mocks.listAlertState.mockResolvedValue([alertRow]);
  mocks.readContractTerms.mockResolvedValue([{ partnerSlug: "scopely", lifecycle: "contract_bound" }]);
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.values(mocks).forEach((mock) => mock.mockReset());
});

describe("loadWorkspace", () => {
  it("marks every partner unavailable when the feed throws, and still reads alerts", async () => {
    mocks.getSlaFeed.mockRejectedValue(new Error("db down"));
    const workspace = await loadWorkspace({});
    expect(workspace.failure).toBe(QUERY_FAILED);
    expect(workspace.partners).toHaveLength(11);
    expect(workspace.partners.every((partner) => partner.unavailable)).toBe(true);
    expect(workspace.alerts).toEqual([alertRow]);
    expect(workspace.health).toEqual({ status: "error" });
    expect(workspace.unusable).toBeNull();
    expect(workspace.chip).toMatchObject({ tone: "danger", href: "/health" });
  });

  it("builds partners normally when only the alert read fails", async () => {
    mocks.getSlaFeed.mockResolvedValue(technicalFeed());
    mocks.listAlertState.mockRejectedValue(new Error("no alert table"));
    const workspace = await loadWorkspace({});
    expect(workspace.role).toBe("technical");
    expect(workspace.failure).toBeNull();
    expect(workspace.alerts).toEqual({ status: "error" });
    expect(workspace.partners.find((partner) => partner.id === "scopely")?.terms).toHaveLength(1);
    expect(workspace.partners.every((partner) => !partner.unavailable)).toBe(true);
    expect(workspace.health).toMatchObject({ usableCount: 1, droppedRows: 0 });
    expect(workspace.unusable).toEqual([]);
    expect(workspace.termsIndex?.bound.has("scopely")).toBe(true);
    expect(workspace.termsIndex?.draft.size).toBe(0);
  });

  it("returns no health, alerts, terms index or backtest for the business role", async () => {
    mocks.getViewer.mockReturnValue({ role: "business" });
    mocks.getSlaFeed.mockResolvedValue(businessFeed());
    const workspace = await loadWorkspace({ backtestPartner: "scopely" });
    expect(workspace.role).toBe("business");
    expect(workspace.health).toBeNull();
    expect(workspace.alerts).toBeNull();
    expect(workspace.unusable).toBeNull();
    expect(workspace.termsIndex).toBeNull();
    expect(workspace.backtest).toBeNull();
    expect(workspace.partners.find((partner) => partner.id === "scopely")).toMatchObject({ merchantIds: null, contractTerms: null });
    expect(mocks.listAlertState).not.toHaveBeenCalled();
    expect(mocks.readContractTerms).not.toHaveBeenCalled();
  });

  it("keeps the business boundary when the feed throws", async () => {
    mocks.getViewer.mockReturnValue({ role: "business" });
    mocks.getSlaFeed.mockRejectedValue(new Error("db down"));
    const workspace = await loadWorkspace({ backtestPartner: "scopely" });
    expect(workspace.failure).toBe(QUERY_FAILED);
    expect(workspace.health).toBeNull();
    expect(workspace.alerts).toBeNull();
    expect(workspace.backtest).toBeNull();
    expect(workspace.chip.href).toBeNull();
    expect(workspace.partners.every((partner) => partner.unavailable && partner.merchantIds === null)).toBe(true);
  });

  it("reports an unconfigured viewer without reading the feed", async () => {
    mocks.getViewer.mockImplementation(() => {
      throw new Error("VIEWER_ROLE must be business, technical, or system.");
    });
    const workspace = await loadWorkspace({});
    expect(workspace.failure).toBe(VIEWER_UNCONFIGURED);
    expect(workspace.partners.every((partner) => partner.unavailable)).toBe(true);
    expect(workspace.health).toEqual({ status: "error" });
    expect(workspace.alerts).toEqual({ status: "error" });
    expect(mocks.getSlaFeed).not.toHaveBeenCalled();
  });

  it("calls getSlaFeed exactly once per request", async () => {
    mocks.getSlaFeed.mockResolvedValue(technicalFeed());
    await loadWorkspace({});
    expect(mocks.getSlaFeed).toHaveBeenCalledTimes(1);
  });
});
