import { PARTNERS, SERVICES, SEVERITIES, resolvePartner, resolveService, resolveSeverity, type PartnerId, type ServiceId } from "@/registry";
import type { ResolvedPartner } from "@/ingestion/resolution";
import type { OutageRow } from "@/ingestion/writer";

/**
 * Correction modal and submission parsing (spec §3 "Correction modal",
 * "Handling a correction"). Pure: no I/O. `correctionModal` builds the
 * Slack view for `views.open`; `parseCorrectionSubmission` reads the
 * `view_submission` payload's `state.values` back into typed, validated
 * data. Blocks are typed minimally and locally, matching the house style
 * in notify/messages.ts — there is no Slack SDK dependency.
 *
 * Block Kit assumption: `datetimepicker`'s value in `state.values` is
 * `{ type: "datetimepicker", selected_date_time: <unix seconds> }`
 * (Slack's documented shape). The parser is tolerant of a numeric string
 * there too, in case that assumption is off.
 */

export const CORRECTION_CALLBACK_ID = "sla_correction";

const MAX_OPTION_TEXT = 75;
const MAX_OPTIONS = 100;

type PlainText = { type: "plain_text"; text: string };
type SelectOption = { text: PlainText; value: string };

export type CorrectionModalReview = {
  incidentStarted: Date;
  outageMinutes: number;
  affectedServices: string[];
  severity: string;
};

export type CorrectionModalInput = {
  pirKey: string;
  version: number;
  rows: OutageRow[];
  review: CorrectionModalReview;
};

/** Builds the Slack modal view for `views.open` (spec §3 "Correction modal"). */
export function correctionModal(input: CorrectionModalInput): unknown {
  const { pirKey, version, rows, review } = input;

  const partnerOptions = toOptions(PARTNERS);
  const serviceOptions = toOptions(SERVICES);
  const severityOptions = toOptions(SEVERITIES);

  const initialPartnerIds = distinctPartnerIds(rows);
  const rowServiceNames = distinctInOrder(rows.map((row) => row.affectedService));
  const serviceNamesForPrefill = rowServiceNames.length > 0 ? rowServiceNames : review.affectedServices;
  const initialServiceIds = distinctServiceIds(serviceNamesForPrefill);

  const incidentStartedSource = rows[0]?.incidentStarted ?? review.incidentStarted;
  const minutesSource = rows[0]?.outageMinutes ?? review.outageMinutes;
  const severitySource = rows[0]?.severity ?? review.severity;

  return {
    type: "modal",
    callback_id: CORRECTION_CALLBACK_ID,
    private_metadata: JSON.stringify({ pirKey, version }),
    title: { type: "plain_text", text: truncate(`Correct ${pirKey}`, 24) },
    submit: { type: "plain_text", text: "Save" },
    close: { type: "plain_text", text: "Cancel" },
    blocks: [
      {
        type: "input",
        block_id: "partners",
        optional: true,
        label: { type: "plain_text", text: "Partners" },
        element: withInitialOptions(
          {
            type: "multi_static_select",
            action_id: "partners_select",
            placeholder: { type: "plain_text", text: "Select partners" },
            options: partnerOptions,
          },
          selectOptionsFor(partnerOptions, initialPartnerIds),
        ),
      },
      {
        type: "input",
        block_id: "services",
        optional: true,
        label: { type: "plain_text", text: "Services" },
        element: withInitialOptions(
          {
            type: "multi_static_select",
            action_id: "services_select",
            placeholder: { type: "plain_text", text: "Select services" },
            options: serviceOptions,
          },
          selectOptionsFor(serviceOptions, initialServiceIds),
        ),
      },
      {
        type: "input",
        block_id: "incident_started",
        label: { type: "plain_text", text: "Incident started (shown in your Slack timezone)" },
        element: {
          type: "datetimepicker",
          action_id: "incident_started_picker",
          initial_date_time: Math.floor(incidentStartedSource.getTime() / 1000),
        },
      },
      {
        type: "input",
        block_id: "minutes",
        label: { type: "plain_text", text: "Outage minutes" },
        element: {
          type: "number_input",
          action_id: "minutes_input",
          is_decimal_allowed: true,
          initial_value: String(minutesSource),
        },
      },
      {
        type: "input",
        block_id: "severity",
        label: { type: "plain_text", text: "Severity" },
        element: withInitialOption(
          {
            type: "static_select",
            action_id: "severity_select",
            placeholder: { type: "plain_text", text: "Select severity" },
            options: severityOptions,
          },
          matchingOption(severityOptions, resolveSeverityId(severitySource)),
        ),
      },
      {
        type: "input",
        block_id: "reason",
        optional: true,
        label: { type: "plain_text", text: "Reason" },
        element: {
          type: "plain_text_input",
          action_id: "reason_input",
          multiline: true,
        },
      },
    ],
  };
}

function toOptions(entries: readonly { id: string; displayName: string }[]): SelectOption[] {
  return entries.slice(0, MAX_OPTIONS).map((entry) => ({
    text: { type: "plain_text", text: truncate(entry.displayName, MAX_OPTION_TEXT) },
    value: entry.id,
  }));
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max);
}

function selectOptionsFor(options: SelectOption[], ids: readonly string[]): SelectOption[] {
  const idSet = new Set(ids);
  return options.filter((option) => idSet.has(option.value));
}

/**
 * Matches the current severity text against the registry rather than exact
 * `displayName` equality, so a variant spelling (an ASCII hyphen instead of
 * the registry's em dash, different casing, an alias) still prefills.
 */
function resolveSeverityId(severityText: string): string | undefined {
  const result = resolveSeverity(severityText);
  return result.status === "resolved" ? result.id : undefined;
}

function matchingOption(options: SelectOption[], id: string | undefined): SelectOption | undefined {
  if (id === undefined) {
    return undefined;
  }
  return options.find((option) => option.value === id);
}

function withInitialOptions<T extends Record<string, unknown>>(element: T, initial: SelectOption[]): T {
  if (initial.length === 0) {
    return element;
  }
  return { ...element, initial_options: initial };
}

function withInitialOption<T extends Record<string, unknown>>(element: T, initial: SelectOption | undefined): T {
  if (initial === undefined) {
    return element;
  }
  return { ...element, initial_option: initial };
}

function distinctInOrder(values: string[]): string[] {
  return Array.from(new Set(values));
}

function distinctPartnerIds(rows: OutageRow[]): PartnerId[] {
  const ids = new Set<PartnerId>();
  for (const row of rows) {
    const result = resolvePartner({ merchantId: null, name: row.partner });
    if (result.status === "resolved") {
      ids.add(result.id);
    }
  }
  return PARTNERS.filter((partner) => ids.has(partner.id)).map((partner) => partner.id);
}

function distinctServiceIds(names: string[]): ServiceId[] {
  const ids = new Set<ServiceId>();
  for (const name of names) {
    const result = resolveService(name);
    if (result.status === "resolved") {
      ids.add(result.id);
    }
  }
  return SERVICES.filter((service) => ids.has(service.id)).map((service) => service.id);
}

// --- Submission parsing -----------------------------------------------

export type CorrectionMetadata = { pirKey: string; version: number };

/**
 * Parses the modal's `private_metadata` back into `{ pirKey, version }`.
 * Throws on anything malformed — the interaction handler turns that throw
 * into a controlled error response instead of crashing.
 */
export function parseCorrectionMetadata(raw: string): CorrectionMetadata {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("correction modal private_metadata is not valid JSON");
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as { pirKey?: unknown }).pirKey !== "string" ||
    typeof (parsed as { version?: unknown }).version !== "number"
  ) {
    throw new Error("correction modal private_metadata is missing pirKey or version");
  }
  return { pirKey: (parsed as { pirKey: string }).pirKey, version: (parsed as { version: number }).version };
}

export type SlackViewLike = {
  private_metadata?: unknown;
  state?: { values?: Record<string, Record<string, unknown>> };
};

export type ParsedCorrectionExtracted = {
  incidentStarted: Date;
  outageMinutes: number;
  affectedServices: string[];
  severity: string;
};

export type ParsedCorrection =
  | {
      ok: true;
      pirKey: string;
      version: number;
      partners: ResolvedPartner[];
      services: { id: ServiceId; displayName: string }[];
      extracted: ParsedCorrectionExtracted;
      reason: string | null;
    }
  | { ok: false; errors: Record<string, string> };

/**
 * Parses a `view_submission` view back into validated data (spec §3
 * "Correction modal", "Handling a correction"). Throws on malformed
 * `private_metadata` (see `parseCorrectionMetadata`); every other problem
 * is a field-level validation error, keyed by `block_id`.
 */
export function parseCorrectionSubmission(
  view: SlackViewLike,
  input: { currentRows: OutageRow[] },
): ParsedCorrection {
  const metadata = parseCorrectionMetadata(typeof view.private_metadata === "string" ? view.private_metadata : "");
  const values = view.state?.values ?? {};

  const errors: Record<string, string> = {};

  const selectedPartnerIds = readMultiSelectValues(values, "partners", "partners_select");
  const selectedServiceIds = readMultiSelectValues(values, "services", "services_select");

  const partners = resolveSelectedPartners(selectedPartnerIds, input.currentRows);
  const services = resolveSelectedServices(selectedServiceIds);

  const incidentStarted = readDateTime(values, "incident_started", "incident_started_picker");
  if (incidentStarted === null) {
    errors.incident_started = "Incident start time is required.";
  }

  const minutesRaw = readValue(values, "minutes", "minutes_input");
  const outageMinutes = typeof minutesRaw === "string" && minutesRaw.trim() !== "" ? Number(minutesRaw) : NaN;
  if (!Number.isFinite(outageMinutes) || outageMinutes <= 0) {
    errors.minutes = "Outage minutes must be greater than 0.";
  }

  const severityId = readSelectedOptionValue(values, "severity", "severity_select");
  const severityEntry = severityId ? SEVERITIES.find((entry) => entry.id === severityId) : undefined;
  if (!severityEntry) {
    errors.severity = "Select a severity.";
  }

  if (partners.length > 0 && services.length === 0) {
    errors.services = "Select at least one service, or clear all partners.";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  const reasonRaw = readValue(values, "reason", "reason_input");
  const reason = typeof reasonRaw === "string" && reasonRaw.trim() !== "" ? reasonRaw.trim() : null;

  return {
    ok: true,
    pirKey: metadata.pirKey,
    version: metadata.version,
    partners,
    services,
    extracted: {
      incidentStarted: incidentStarted as Date,
      outageMinutes,
      affectedServices: services.map((service) => service.displayName),
      severity: severityEntry!.displayName,
    },
    reason,
  };
}

function resolveSelectedPartners(ids: string[], currentRows: OutageRow[]): ResolvedPartner[] {
  const idSet = new Set(ids);
  return PARTNERS.filter((entry) => idSet.has(entry.id)).map((entry) => {
    const existingRow = currentRows.find((row) => row.partner === entry.displayName);
    if (existingRow) {
      return { id: entry.id, displayName: entry.displayName, merchantId: existingRow.partnerId };
    }
    // No existing row for this partner — fall back to the registry's
    // single merchantId, or null when there's more than one.
    const merchantId = entry.merchantIds.length === 1 ? String(entry.merchantIds[0]) : null;
    return { id: entry.id, displayName: entry.displayName, merchantId };
  });
}

function resolveSelectedServices(ids: string[]): { id: ServiceId; displayName: string }[] {
  const idSet = new Set(ids);
  return SERVICES.filter((entry) => idSet.has(entry.id)).map((entry) => ({ id: entry.id, displayName: entry.displayName }));
}

function readValue(values: Record<string, Record<string, unknown>>, blockId: string, actionId: string): unknown {
  const action = values[blockId]?.[actionId] as Record<string, unknown> | undefined;
  return action?.value;
}

function readMultiSelectValues(values: Record<string, Record<string, unknown>>, blockId: string, actionId: string): string[] {
  const action = values[blockId]?.[actionId] as { selected_options?: { value?: unknown }[] } | undefined;
  const options = action?.selected_options ?? [];
  return options.map((option) => option.value).filter((value): value is string => typeof value === "string");
}

function readSelectedOptionValue(values: Record<string, Record<string, unknown>>, blockId: string, actionId: string): string | undefined {
  const action = values[blockId]?.[actionId] as { selected_option?: { value?: unknown } } | undefined;
  const value = action?.selected_option?.value;
  return typeof value === "string" ? value : undefined;
}

/**
 * Block Kit assumption (see module doc): `selected_date_time` is unix
 * seconds. Tolerant of a numeric string too, in case that shape is off.
 */
function readDateTime(values: Record<string, Record<string, unknown>>, blockId: string, actionId: string): Date | null {
  const action = values[blockId]?.[actionId] as { selected_date_time?: unknown } | undefined;
  const raw = action?.selected_date_time;
  const seconds = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(seconds)) {
    return null;
  }
  return new Date(seconds * 1000);
}
