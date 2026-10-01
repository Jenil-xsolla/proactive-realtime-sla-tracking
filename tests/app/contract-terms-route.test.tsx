import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET, PUT } from "@/app/api/sla/contract-terms/[partner]/route";
import { ADD_CONTRACT_TERMS, VIEW_TERMS } from "@/app/dashboard/copy";
import { buildPartnerGroups } from "@/app/dashboard/model";
import { PartnerTable } from "@/app/dashboard/partner-table";
import PartnerTermsPage from "@/app/partners/[partner]/terms/page";
import {
  partitionOutages,
  readContractTerms,
  type Database,
  type IngestionHealth,
  type OutageSourceRow,
} from "@/data";
import { getSlaFeed } from "@/feed";
import { DbTermsProvider, type ContractScope } from "@/terms";
import { createTestDatabase, type TestDatabase } from "../support/database";

const dbBox = vi.hoisted(() => ({ current: undefined as Database | undefined }));

vi.mock("@/data", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/data")>();
  return {
    ...actual,
    getDatabase: () => {
      if (dbBox.current === undefined) {
        throw new Error("test database is not open");
      }
      return dbBox.current;
    },
  };
});

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({
    push: () => undefined,
    refresh: () => undefined,
  }),
}));

const AS_OF = new Date("2026-06-15T12:00:00.000Z");
const WINDOW = {
  start: new Date("2026-06-01T00:00:00.000Z"),
  end: new Date("2026-07-01T00:00:00.000Z"),
};

function scope(overrides: Partial<ContractScope> = {}): ContractScope {
  return {
    kind: "service",
    scopeId: "payments",
    services: ["payments"],
    target: 97.25,
    penalty: { kind: "none" },
    sourceClause: "FIXTURE clause alpha",
    ...overrides,
  };
}

function terms(overrides: Partial<ContractScope> = {}) {
  return {
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    contractAggregateCap: null,
    scopes: [scope(overrides)],
  };
}

function saveBody(
  lifecycle: "terms_pending_review" | "contract_bound",
  expectedVersion: number | null,
  updatedBy: string,
  body = terms(),
) {
  return {
    expectedVersion,
    lifecycle,
    updatedBy,
    terms: body,
  };
}

function put(partner: string, body: unknown): Promise<Response> {
  return PUT(new Request(`http://localhost/api/sla/contract-terms/${partner}`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }), { params: Promise.resolve({ partner }) });
}

function outage(overrides: Partial<OutageSourceRow> = {}): OutageSourceRow {
  return {
    id: 1,
    pirKey: "GTO-1",
    partner: "Roblox",
    partnerId: "38519",
    incidentStarted: new Date("2026-06-10T12:00:00.000Z"),
    affectedService: "Payments",
    outageMinutes: "10",
    severity: "L1",
    source: "pipeline",
    reviewedBy: null,
    decisionType: "system_written",
    reviewedAt: null,
    pirUrl: null,
    ...overrides,
  };
}

function ingestion(): IngestionHealth {
  return {
    failed: { items: [], totalCount: 0 },
    unresolved: { items: [], totalCount: 0 },
    withoutMessage: { items: [], totalCount: 0 },
  };
}

describe("contract terms routes and technical view", () => {
  let testDb: TestDatabase | undefined;

  afterEach(async () => {
    dbBox.current = undefined;
    await testDb?.close();
    testDb = undefined;
  });

  async function openDb(): Promise<TestDatabase> {
    testDb = await createTestDatabase();
    dbBox.current = testDb.db;
    return testDb;
  }

  it("offers Add contract terms when a partner has no row, and View terms when one exists", () => {
    const html = renderToStaticMarkup(
      <PartnerTable partners={buildPartnerGroups([], new Set(["roblox"]))} />,
    );
    const scopely = partnerSection(html, "Scopely");
    const roblox = partnerSection(html, "Roblox");
    expect(scopely).toContain(ADD_CONTRACT_TERMS);
    expect(scopely).toContain('href="/partners/scopely/terms"');
    expect(scopely).not.toContain(VIEW_TERMS);
    expect(roblox).toContain(VIEW_TERMS);
    expect(roblox).toContain('href="/partners/roblox/terms"');
    expect(roblox).not.toContain(ADD_CONTRACT_TERMS);
  });

  it("adds terms, shows them, then shows an edit", async () => {
    await openDb();

    const created = await put("roblox", saveBody("terms_pending_review", null, "ada"));
    expect(created.status).toBe(200);
    expect(created.headers.get("cache-control")).toBe("no-store");
    expect(await created.json()).toEqual({ kind: "saved", version: 1 });

    const loaded = await GET(new Request("http://localhost/api/sla/contract-terms/roblox"), {
      params: Promise.resolve({ partner: "roblox" }),
    });
    const present = (await loaded.json()) as { kind: string; version: number; terms: { scopes: ContractScope[] } };
    expect(present.kind).toBe("present");
    expect(present.version).toBe(1);
    expect(present.terms.scopes[0]?.sourceClause).toBe("FIXTURE clause alpha");
    expect(present.terms.scopes[0]?.target).toBe(97.25);

    const view = renderToStaticMarkup(
      await PartnerTermsPage({
        params: Promise.resolve({ partner: "roblox" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(view).toContain("FIXTURE clause alpha");
    expect(view).toContain("97.25%");
    expect(view).toContain("Draft. These terms are not scoring.");
    expect(view).toContain('href="/partners/roblox/terms?edit=1"');
    expect(view).toContain(">Edit<");
    expect(view).not.toContain("99.95");
    expect(view).not.toContain("99.9");

    const editing = renderToStaticMarkup(
      await PartnerTermsPage({
        params: Promise.resolve({ partner: "roblox" }),
        searchParams: Promise.resolve({ edit: "1" }),
      }),
    );
    expect(inputValue(editing, "target-payments")).toBe("97.25");
    expect(inputValue(editing, "updated-by")).toBe("");
    expect(editing).not.toMatch(/placeholder=/i);
    expect(editing).not.toContain("99.95");

    const updated = await put(
      "roblox",
      saveBody("terms_pending_review", 1, "grace", terms({ target: 96.5, sourceClause: "FIXTURE clause beta" })),
    );
    expect(updated.status).toBe(200);
    expect(await updated.json()).toEqual({ kind: "saved", version: 2 });

    const again = renderToStaticMarkup(
      await PartnerTermsPage({
        params: Promise.resolve({ partner: "roblox" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(again).toContain("FIXTURE clause beta");
    expect(again).toContain("96.5%");
    expect(again).not.toContain("FIXTURE clause alpha");
    expect(again).toContain("Last saved by grace");
  });

  it("does not score a draft, and scores once the same terms are activated", async () => {
    const database = await openDb();

    const drafted = await put("roblox", saveBody("terms_pending_review", null, "ada"));
    expect(drafted.status).toBe(200);

    const draftFeed = await feedFor(database);
    const draftRows = draftFeed.filter((row) => row.partner === "roblox");
    expect(draftRows.length).toBeGreaterThan(0);
    expect(draftRows.every((row) => row.kind === "tracking_only")).toBe(true);

    const activated = await put("roblox", saveBody("contract_bound", 1, "ada"));
    expect(activated.status).toBe(200);

    const activeFeed = await feedFor(database);
    const activeRows = activeFeed.filter((row) => row.partner === "roblox");
    expect(activeRows.length).toBeGreaterThan(0);
    expect(activeRows.every((row) => row.kind === "scored")).toBe(true);
  });

  it("refuses a stale version and leaves the saved terms in place", async () => {
    const database = await openDb();
    expect((await put("roblox", saveBody("terms_pending_review", null, "ada"))).status).toBe(200);
    expect(
      (await put("roblox", saveBody("terms_pending_review", 1, "grace", terms({ sourceClause: "FIXTURE clause beta" }))))
        .status,
    ).toBe(200);

    const conflict = await put(
      "roblox",
      saveBody("contract_bound", 1, "ada", terms({ sourceClause: "FIXTURE clause gamma" })),
    );
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get("cache-control")).toBe("no-store");
    expect(await conflict.json()).toEqual({ kind: "conflict" });

    const rows = await readContractTerms(database.db);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(2);
    expect(rows[0]?.terms.scopes[0]?.sourceClause).toBe("FIXTURE clause beta");
    expect(rows[0]?.lifecycle).toBe("terms_pending_review");
  });

  it("rejects an invalid tier list on the server and writes nothing", async () => {
    const database = await openDb();
    const response = await put(
      "roblox",
      saveBody("contract_bound", null, "ada", terms({
        penalty: {
          kind: "tiers",
          perScopeCap: null,
          tiers: [{ atOrAbove: 97.25, credit: 10 }],
        },
      })),
    );

    expect(response.status).toBe(400);
    const body = (await response.json()) as { kind: string; errors: { field: string; message: string }[] };
    expect(body.kind).toBe("invalid");
    expect(body.errors).toEqual([
      expect.objectContaining({
        field: "scopes.payments.tiers",
        message: expect.stringMatching(/last tier atOrAbove must be 0/),
      }),
    ]);
    expect(await readContractTerms(database.db)).toEqual([]);
  });

  it("renders an empty add form with no contract figures", async () => {
    await openDb();
    const html = renderToStaticMarkup(
      await PartnerTermsPage({
        params: Promise.resolve({ partner: "niantic" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(html).toContain("Add contract terms");
    expect(html).not.toMatch(/placeholder=/i);
    expect(html).not.toContain("99.95");
    expect(html).not.toContain("99.9");
    expect(html).not.toContain("EXAMPLE");
    expect(inputValue(html, "effective-from")).toBe("");
    expect(inputValue(html, "target-scope-1")).toBe("");
    expect(inputValue(html, "updated-by")).toBe("");
  });
});

function inputValue(html: string, id: string): string | undefined {
  const tag = html.match(/<input\b[^>]*>/g)?.find((item) => item.includes(`id="${id}"`));
  return tag?.match(/\bvalue="([^"]*)"/)?.[1];
}

function partnerSection(html: string, name: string): string {
  const start = html.indexOf(`>${name}<`);
  expect(start).toBeGreaterThan(-1);
  const next = html.indexOf("<h3", start + 1);
  return html.slice(start, next === -1 ? undefined : next);
}

async function feedFor(database: TestDatabase) {
  const feed = await getSlaFeed({
    asOf: AS_OF,
    window: WINDOW,
    viewer: { role: "technical" },
    sources: {
      terms: new DbTermsProvider(() => readContractTerms(database.db)),
      partition: partitionOutages([outage()]),
      ingestion: ingestion(),
    },
  });
  if (feed.role !== "technical") {
    throw new Error("expected a technical feed");
  }
  return feed.rows;
}
