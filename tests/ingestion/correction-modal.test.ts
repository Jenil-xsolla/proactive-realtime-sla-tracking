import { describe, expect, it } from "vitest";
import { PARTNERS, SERVICES, SEVERITIES } from "@/registry";
import {
  correctionModal,
  parseCorrectionMetadata,
  parseCorrectionSubmission,
  type CorrectionModalReview,
} from "@/ingestion/notify/correction-modal";
import type { OutageRow } from "@/ingestion/writer";

const INCIDENT_STARTED = new Date("2026-09-28T09:00:00.000Z");
const PIR_URL = "https://xsolla.atlassian.net/browse/GTO-543";

function outageRow(overrides: Partial<OutageRow> = {}): OutageRow {
  return {
    partner: "Scopely",
    partnerId: "151639",
    affectedService: "Payments",
    incidentStarted: INCIDENT_STARTED,
    outageMinutes: 30,
    severity: "L1 — Critical",
    pirUrl: PIR_URL,
    ...overrides,
  };
}

function review(overrides: Partial<CorrectionModalReview> = {}): CorrectionModalReview {
  return {
    incidentStarted: INCIDENT_STARTED,
    outageMinutes: 30,
    affectedServices: ["Payments"],
    severity: "L1 — Critical",
    ...overrides,
  };
}

function findBlock(view: ReturnType<typeof correctionModal>, blockId: string): Record<string, unknown> {
  const blocks = (view as { blocks: Record<string, unknown>[] }).blocks;
  const block = blocks.find((b) => b.block_id === blockId);
  if (!block) {
    throw new Error(`no block with block_id ${blockId}`);
  }
  return block;
}

describe("correctionModal", () => {
  it("has callback_id sla_correction and private_metadata with pirKey and version", () => {
    const view = correctionModal({
      pirKey: "GTO-543",
      version: 3,
      rows: [outageRow()],
      review: review(),
    }) as Record<string, unknown>;

    expect(view.callback_id).toBe("sla_correction");
    expect(JSON.parse(view.private_metadata as string)).toEqual({ pirKey: "GTO-543", version: 3 });
  });

  it("prefills partners and services from the current rows", () => {
    const view = correctionModal({
      pirKey: "GTO-543",
      version: 0,
      rows: [
        outageRow({ partner: "Scopely", affectedService: "Payments" }),
        outageRow({ partner: "Scopely", affectedService: "Login" }),
        outageRow({ partner: "Bandai Namco", partnerId: "503608", affectedService: "Payments" }),
      ],
      review: review(),
    }) as { blocks: Record<string, unknown>[] };

    const partnersBlock = findBlock(view, "partners");
    const partnersElement = partnersBlock.element as { initial_options?: { value: string }[] };
    expect(new Set(partnersElement.initial_options?.map((o) => o.value))).toEqual(
      new Set(["scopely", "bandai-namco"]),
    );

    const servicesBlock = findBlock(view, "services");
    const servicesElement = servicesBlock.element as { initial_options?: { value: string }[] };
    expect(new Set(servicesElement.initial_options?.map((o) => o.value))).toEqual(new Set(["payments", "login"]));
  });

  it("prefills incident_started, minutes and severity from the review when there are zero rows (D4)", () => {
    const view = correctionModal({
      pirKey: "GTO-999",
      version: 0,
      rows: [],
      review: review({ incidentStarted: INCIDENT_STARTED, outageMinutes: 42, severity: "L2 — Major" }),
    }) as { blocks: Record<string, unknown>[] };

    const partnersBlock = findBlock(view, "partners");
    const partnersElement = partnersBlock.element as { initial_options?: unknown[] };
    expect(partnersElement.initial_options ?? []).toHaveLength(0);

    const incidentBlock = findBlock(view, "incident_started");
    const incidentElement = incidentBlock.element as { initial_date_time: number };
    expect(incidentElement.initial_date_time).toBe(Math.floor(INCIDENT_STARTED.getTime() / 1000));

    const minutesBlock = findBlock(view, "minutes");
    const minutesElement = minutesBlock.element as { initial_value: string };
    expect(minutesElement.initial_value).toBe("42");

    const severityBlock = findBlock(view, "severity");
    const severityElement = severityBlock.element as { initial_option?: { value: string } };
    expect(severityElement.initial_option?.value).toBe("l2");
  });

  it("prefills severity by resolving the current rows' text, not exact displayName equality (an ASCII hyphen still matches the registry's em dash)", () => {
    const view = correctionModal({
      pirKey: "GTO-543",
      version: 0,
      rows: [outageRow({ severity: "L1 - Critical" })],
      review: review({ severity: "L1 - Critical" }),
    }) as { blocks: Record<string, unknown>[] };

    const severityBlock = findBlock(view, "severity");
    const severityElement = severityBlock.element as { initial_option?: { value: string } };
    expect(severityElement.initial_option?.value).toBe("l1");
  });

  it("prefills services from the review's affectedServices when there are zero rows (D4)", () => {
    const view = correctionModal({
      pirKey: "GTO-999",
      version: 0,
      rows: [],
      review: review({ affectedServices: ["Login", "Payments"] }),
    }) as { blocks: Record<string, unknown>[] };

    const servicesBlock = findBlock(view, "services");
    const servicesElement = servicesBlock.element as { initial_options?: { value: string }[] };
    expect(new Set(servicesElement.initial_options?.map((o) => o.value))).toEqual(new Set(["login", "payments"]));
  });

  it("builds partner options only from the registry (id/displayName pairs)", () => {
    const view = correctionModal({
      pirKey: "GTO-543",
      version: 0,
      rows: [],
      review: review(),
    }) as { blocks: Record<string, unknown>[] };

    const partnersBlock = findBlock(view, "partners");
    const partnersElement = partnersBlock.element as { options: { value: string; text: { text: string } }[] };
    expect(partnersElement.options).toHaveLength(PARTNERS.length);
    for (const option of partnersElement.options) {
      const entry = PARTNERS.find((p) => p.id === option.value);
      expect(entry).toBeDefined();
      expect(option.text.text).toBe(entry?.displayName);
    }
  });

  it("builds service options only from the registry", () => {
    const view = correctionModal({
      pirKey: "GTO-543",
      version: 0,
      rows: [],
      review: review(),
    }) as { blocks: Record<string, unknown>[] };

    const servicesBlock = findBlock(view, "services");
    const servicesElement = servicesBlock.element as { options: unknown[] };
    expect(servicesElement.options).toHaveLength(SERVICES.length);
  });

  it("builds severity options only from the registry", () => {
    const view = correctionModal({
      pirKey: "GTO-543",
      version: 0,
      rows: [],
      review: review(),
    }) as { blocks: Record<string, unknown>[] };

    const severityBlock = findBlock(view, "severity");
    const severityElement = severityBlock.element as { options: unknown[] };
    expect(severityElement.options).toHaveLength(SEVERITIES.length);
  });
});

describe("parseCorrectionMetadata", () => {
  it("parses a well-formed private_metadata string", () => {
    expect(parseCorrectionMetadata(JSON.stringify({ pirKey: "GTO-1", version: 2 }))).toEqual({
      pirKey: "GTO-1",
      version: 2,
    });
  });

  it("throws on malformed JSON", () => {
    expect(() => parseCorrectionMetadata("not json")).toThrow();
  });

  it("throws when pirKey or version is missing", () => {
    expect(() => parseCorrectionMetadata(JSON.stringify({ pirKey: "GTO-1" }))).toThrow();
    expect(() => parseCorrectionMetadata(JSON.stringify({ version: 2 }))).toThrow();
  });
});

function viewWithValues(values: Record<string, Record<string, unknown>>, metadata = { pirKey: "GTO-543", version: 0 }) {
  return {
    private_metadata: JSON.stringify(metadata),
    state: { values },
  };
}

function fullValidValues(overrides: Record<string, Record<string, unknown>> = {}) {
  return {
    partners: {
      partners_select: { type: "multi_static_select", selected_options: [{ value: "scopely" }] },
    },
    services: {
      services_select: { type: "multi_static_select", selected_options: [{ value: "payments" }] },
    },
    incident_started: {
      incident_started_picker: { type: "datetimepicker", selected_date_time: 1758790800 },
    },
    minutes: {
      minutes_input: { type: "number_input", value: "45.5" },
    },
    severity: {
      severity_select: { type: "static_select", selected_option: { value: "l1" } },
    },
    reason: {
      reason_input: { type: "plain_text_input", value: "fixed it" },
    },
    ...overrides,
  };
}

describe("parseCorrectionSubmission", () => {
  it("parses a fully filled-out valid submission", () => {
    const result = parseCorrectionSubmission(viewWithValues(fullValidValues()), { currentRows: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.pirKey).toBe("GTO-543");
    expect(result.version).toBe(0);
    expect(result.partners.map((p) => p.id)).toEqual(["scopely"]);
    expect(result.services.map((s) => s.id)).toEqual(["payments"]);
    expect(result.extracted.outageMinutes).toBe(45.5);
    expect(result.extracted.severity).toBe("L1 — Critical");
    expect(result.extracted.incidentStarted).toEqual(new Date(1758790800 * 1000));
    expect(result.extracted.affectedServices).toEqual(["Payments"]);
    expect(result.reason).toBe("fixed it");
  });

  it("clearing every partner is valid (no pilot partner affected)", () => {
    const result = parseCorrectionSubmission(
      viewWithValues(
        fullValidValues({
          partners: { partners_select: { type: "multi_static_select", selected_options: [] } },
          services: { services_select: { type: "multi_static_select", selected_options: [] } },
        }),
      ),
      { currentRows: [] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.partners).toEqual([]);
    expect(result.services).toEqual([]);
  });

  it("errors when minutes is not greater than 0", () => {
    const result = parseCorrectionSubmission(
      viewWithValues(fullValidValues({ minutes: { minutes_input: { type: "number_input", value: "0" } } })),
      { currentRows: [] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.minutes).toBeTruthy();
  });

  it("errors when incident_started is missing", () => {
    const result = parseCorrectionSubmission(
      viewWithValues(fullValidValues({ incident_started: { incident_started_picker: { type: "datetimepicker" } } })),
      { currentRows: [] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.incident_started).toBeTruthy();
  });

  it("errors when severity is missing", () => {
    const result = parseCorrectionSubmission(
      viewWithValues(fullValidValues({ severity: { severity_select: { type: "static_select" } } })),
      { currentRows: [] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.severity).toBeTruthy();
  });

  it("errors when a partner is selected but no service is", () => {
    const result = parseCorrectionSubmission(
      viewWithValues(
        fullValidValues({
          services: { services_select: { type: "multi_static_select", selected_options: [] } },
        }),
      ),
      { currentRows: [] },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.services).toBeTruthy();
  });

  it("throws on malformed private_metadata", () => {
    expect(() =>
      parseCorrectionSubmission({ private_metadata: "not json", state: { values: fullValidValues() } }, { currentRows: [] }),
    ).toThrow();
  });

  it("accepts selected_date_time given as a numeric string, tolerantly", () => {
    const result = parseCorrectionSubmission(
      viewWithValues(
        fullValidValues({
          incident_started: {
            incident_started_picker: { type: "datetimepicker", selected_date_time: "1758790800" },
          },
        }),
      ),
      { currentRows: [] },
    );
    expect(result.ok).toBe(true);
  });

  it("retains the partnerId of an existing row for a still-selected partner", () => {
    const currentRows: OutageRow[] = [outageRow({ partner: "Scopely", partnerId: "999999" })];
    const result = parseCorrectionSubmission(viewWithValues(fullValidValues()), { currentRows });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const scopely = result.partners.find((p) => p.id === "scopely");
    expect(scopely?.merchantId).toBe("999999");
  });

  it("uses the registry's single merchantId (A7) for a newly selected partner with no existing row", () => {
    const result = parseCorrectionSubmission(
      viewWithValues(
        fullValidValues({
          partners: { partners_select: { type: "multi_static_select", selected_options: [{ value: "niantic" }] } },
        }),
      ),
      { currentRows: [] },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const niantic = result.partners.find((p) => p.id === "niantic");
    expect(niantic?.merchantId).toBe("221437");
  });
});
