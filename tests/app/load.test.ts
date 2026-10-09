import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UNUSABLE_REASONS } from "@/data";
import type { AlertStateRow } from "@/data";
import type { SlaFeed } from "@/feed";
import { DbTermsProvider } from "@/terms";
import { QUERY_FAILED, VIEWER_UNCONFIGURED } from "@/app/dashboard/copy";
import { businessScoredRow, scoredRow } from "../support/rows";

const mocks = vi.hoisted(() => ({
  getSlaFeed: vi.fn(),
  getSlaHealth: vi.fn(),
  listAlertState: vi.fn(),
  readContractTerms: vi.fn(),
}));
const originalRole = process.env.VIEWER_ROLE;
const cookieBox = vi.hoisted(() => ({ value: undefined as string | undefined }));

vi.mock("next/cache", () => ({ unstable_noStore: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "sla_view" && cookieBox.value !== undefined ? { name, value: cookieBox.value } : undefined) }),
}));
vi.mock("@/feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/feed")>()),
  getSlaFeed: mocks.getSlaFeed,
  getSlaHealth: mocks.getSlaHealth,
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
  lastStatus: "breached",
  lastAlertedAt: null,
  alertCount: 1,
  updatedAt: new Date(0),
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  process.env.VIEWER_ROLE = "technical";
  mocks.getSlaHealth.mockResolvedValue({ role: "technical", unusable: [] });
  mocks.listAlertState.mockResolvedValue([alertRow]);
  mocks.readContractTerms.mockResolvedValue([{ partnerSlug: "scopely", lifecycle: "contract_bound" }]);
});

afterEach(() => {
  vi.restoreAllMocks();
  Object.values(mocks).forEach((mock) => mock.mockReset());
  cookieBox.value = undefined;
  if (originalRole === undefined) {
    delete process.env.VIEWER_ROLE;
  } else {
    process.env.VIEWER_ROLE = originalRole;
  }
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
    expect(workspace.view).toEqual({ active: "technical" });
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
    expect(workspace.unusable).toBeNull();
    expect(workspace.termsIndex?.bound.has("scopely")).toBe(true);
    expect(workspace.termsIndex?.draft.size).toBe(0);
  });

  it("returns no health, alerts, terms index or backtest for the business role", async () => {
    process.env.VIEWER_ROLE = "business";
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
    process.env.VIEWER_ROLE = "business";
    mocks.getSlaFeed.mockRejectedValue(new Error("db down"));
    const workspace = await loadWorkspace({ backtestPartner: "scopely" });
    expect(workspace.failure).toBe(QUERY_FAILED);
    expect(workspace.health).toBeNull();
    expect(workspace.alerts).toBeNull();
    expect(workspace.backtest).toBeNull();
    expect(workspace.view).toEqual({ active: "business" });
    expect(workspace.partners.every((partner) => partner.unavailable && partner.merchantIds === null)).toBe(true);
  });

  it("reports an unconfigured viewer without reading the feed", async () => {
    process.env.VIEWER_ROLE = "nonsense";
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

  it("reads contract terms once per request and hands the same rows to the feed", async () => {
    mocks.getSlaFeed.mockResolvedValue(technicalFeed());
    const workspace = await loadWorkspace({});
    expect(mocks.readContractTerms).toHaveBeenCalledTimes(1);
    const sources = mocks.getSlaFeed.mock.calls[0]?.[0].sources;
    expect(sources?.terms).toBeInstanceOf(DbTermsProvider);
    expect(await sources.terms.listScopes("scopely", new Date())).toEqual([]);
    expect(mocks.readContractTerms).toHaveBeenCalledTimes(1);
    expect(workspace.termsIndex?.bound.has("scopely")).toBe(true);
  });

  it("never reads the second health view by default, and reads it once when asked", async () => {
    mocks.getSlaFeed.mockResolvedValue(technicalFeed());
    const plain = await loadWorkspace({});
    expect(mocks.getSlaHealth).not.toHaveBeenCalled();
    expect(plain.unusable).toBeNull();

    const asked = await loadWorkspace({ unusable: true });
    expect(mocks.getSlaHealth).toHaveBeenCalledTimes(1);
    expect(asked.unusable).toEqual([]);
    expect(mocks.getSlaFeed).toHaveBeenCalledTimes(2);
  });

  it("keeps unusable null when the opted-in health read fails", async () => {
    mocks.getSlaFeed.mockResolvedValue(technicalFeed());
    mocks.getSlaHealth.mockRejectedValue(new Error("db down"));
    const workspace = await loadWorkspace({ unusable: true });
    expect(workspace.unusable).toBeNull();
    expect(workspace.health).toMatchObject({ usableCount: 1 });
  });

  it("builds month hrefs on the page's own path", async () => {
    mocks.getSlaFeed.mockResolvedValue(technicalFeed());
    const workspace = await loadWorkspace({ windowPath: "/alerts" });
    expect(workspace.frame.months.every((month) => month.href.startsWith("/alerts?window="))).toBe(true);
    const home = await loadWorkspace({});
    expect(home.frame.months.every((month) => month.href.startsWith("/?window="))).toBe(true);
  });

  it("lets the view cookie override the viewer role, and follows the deployment default without one", async () => {
    process.env.VIEWER_ROLE = "technical";
    mocks.getSlaFeed.mockImplementation(async ({ viewer }: { viewer: { role: string } }) => (viewer.role === "business" ? businessFeed() : technicalFeed()));

    cookieBox.value = "business";
    const business = await loadWorkspace({});
    expect(business.role).toBe("business");
    expect(business.view).toEqual({ active: "business" });
    expect(mocks.getSlaFeed.mock.calls[0]?.[0].viewer).toEqual({ role: "business" });
    expect(business.health).toBeNull();

    cookieBox.value = undefined;
    const fallback = await loadWorkspace({});
    expect(fallback.role).toBe("technical");
    expect(fallback.view).toEqual({ active: "technical" });
  });

  it("lets a technical cookie win over a business deployment default", async () => {
    process.env.VIEWER_ROLE = "business";
    mocks.getSlaFeed.mockResolvedValue(technicalFeed());
    cookieBox.value = "technical";
    const workspace = await loadWorkspace({});
    expect(workspace.role).toBe("technical");
    expect(workspace.view).toEqual({ active: "technical" });
  });
});
