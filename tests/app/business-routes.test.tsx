import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AS_OF, WINDOW, businessFeedSources } from "../support/business-feed";

const mocks = vi.hoisted(() => ({
  getSlaFeed: vi.fn(),
}));

vi.mock("next/cache", () => ({ unstable_noStore: () => undefined }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/feed", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/feed")>()),
  getSlaFeed: mocks.getSlaFeed,
}));

const { default: AlertsRoute } = await import("@/app/alerts/page");
const { default: HealthRoute } = await import("@/app/health/page");

const originalRole = process.env.VIEWER_ROLE;

describe("engineer-only routes for the business role", () => {
  afterEach(() => {
    if (originalRole === undefined) {
      delete process.env.VIEWER_ROLE;
    } else {
      process.env.VIEWER_ROLE = originalRole;
    }
  });

  beforeEach(async () => {
    process.env.VIEWER_ROLE = "business";
    // The mocked module is bypassed here on purpose: the feed handed to the route is a real business evaluation.
    const actual = await vi.importActual<typeof import("@/feed")>("@/feed");
    mocks.getSlaFeed.mockResolvedValue(
      await actual.getSlaFeed({ asOf: AS_OF, window: WINDOW, viewer: { role: "business" }, sources: businessFeedSources() }),
    );
  });

  it("returns not found for /alerts", async () => {
    await expect(AlertsRoute({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("returns not found for /health", async () => {
    await expect(HealthRoute({ searchParams: Promise.resolve({}) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
