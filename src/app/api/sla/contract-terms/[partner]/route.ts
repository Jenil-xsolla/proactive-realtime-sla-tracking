import { unstable_noStore as noStore } from "next/cache";
import { NextResponse } from "next/server";
import {
  getDatabase,
  readContractTermsForPartner,
  saveContractTerms,
  type ContractTermsBody,
} from "@/data";
import { isPartnerId, type ServiceId } from "@/registry";
import {
  fieldForLoadMessage,
  reviewStoredTerms,
  type ContractPenalty,
  type ContractScope,
  type FieldIssue,
} from "@/terms";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

function invalid(errors: FieldIssue[]): NextResponse {
  return json({ kind: "invalid", errors }, 400);
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ partner: string }> },
): Promise<NextResponse> {
  noStore();
  const { partner } = await context.params;
  if (!isPartnerId(partner)) {
    return json({ kind: "not_found" }, 404);
  }
  const row = await readContractTermsForPartner(getDatabase(), partner);
  if (row === null) {
    return json({ kind: "absent" }, 200);
  }
  return json(
    {
      kind: "present",
      partner: row.partnerSlug,
      lifecycle: row.lifecycle,
      version: row.version,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt.toISOString(),
      terms: row.terms,
    },
    200,
  );
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ partner: string }> },
): Promise<NextResponse> {
  noStore();
  const { partner } = await context.params;
  if (!isPartnerId(partner)) {
    return json({ kind: "not_found" }, 404);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return invalid([{ field: "form", message: "Request body must be JSON." }]);
  }

  const parsed = parseSaveBody(payload);
  if (!parsed.ok) {
    return invalid(parsed.errors);
  }

  const review = reviewStoredTerms(partner, parsed.lifecycle, parsed.terms, parsed.updatedBy);
  if (review.errors.length > 0) {
    return invalid(review.errors);
  }

  try {
    const result = await saveContractTerms(
      getDatabase(),
      partner,
      parsed.terms,
      parsed.lifecycle,
      parsed.updatedBy,
      parsed.expectedVersion,
    );
    if (result.kind === "conflict") {
      return json({ kind: "conflict" }, 409);
    }
    return json({ kind: "saved", version: result.version }, 200);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Contract terms could not be saved.";
    return invalid([{ field: fieldForLoadMessage(message), message }]);
  }
}

type ParsedSave = {
  ok: true;
  expectedVersion: number | null;
  lifecycle: "terms_pending_review" | "contract_bound";
  updatedBy: string;
  terms: ContractTermsBody;
};

function parseSaveBody(payload: unknown): ParsedSave | { ok: false; errors: FieldIssue[] } {
  if (!isRecord(payload)) {
    return { ok: false, errors: [{ field: "form", message: "Request body must be an object." }] };
  }
  const errors: FieldIssue[] = [];
  const expectedVersion = parseExpectedVersion(payload.expectedVersion, errors);
  const lifecycle = parseLifecycle(payload.lifecycle, errors);
  const updatedBy = typeof payload.updatedBy === "string" ? payload.updatedBy : "";
  if (typeof payload.updatedBy !== "string") {
    errors.push({ field: "updatedBy", message: "Enter your name." });
  }
  const terms = parseTerms(payload.terms, errors);
  if (expectedVersion === undefined || lifecycle === undefined || terms === undefined || errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, expectedVersion, lifecycle, updatedBy, terms };
}

function parseExpectedVersion(value: unknown, errors: FieldIssue[]): number | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value === "number" && Number.isInteger(value) && value >= 1) {
    return value;
  }
  errors.push({ field: "expectedVersion", message: "Save the version you opened, or null when adding terms." });
  return undefined;
}

function parseLifecycle(
  value: unknown,
  errors: FieldIssue[],
): "terms_pending_review" | "contract_bound" | undefined {
  if (value === "terms_pending_review" || value === "contract_bound") {
    return value;
  }
  errors.push({ field: "lifecycle", message: "Save a draft or activate. Those are the only two saves." });
  return undefined;
}

function parseTerms(value: unknown, errors: FieldIssue[]): ContractTermsBody | undefined {
  if (!isRecord(value)) {
    errors.push({ field: "form", message: "Terms must be an object." });
    return undefined;
  }
  const effectiveFrom = typeof value.effectiveFrom === "string" ? value.effectiveFrom : "";
  if (typeof value.effectiveFrom !== "string") {
    errors.push({ field: "effectiveFrom", message: "Effective from is required." });
  }
  let effectiveTo: string | null = null;
  if (value.effectiveTo !== null && value.effectiveTo !== undefined) {
    if (typeof value.effectiveTo !== "string") {
      errors.push({ field: "effectiveTo", message: "Effective to must be a date or null." });
    } else {
      effectiveTo = value.effectiveTo;
    }
  }
  let contractAggregateCap: number | null = null;
  if (value.contractAggregateCap !== null && value.contractAggregateCap !== undefined) {
    if (typeof value.contractAggregateCap !== "number") {
      errors.push({ field: "contractAggregateCap", message: "Aggregate cap must be a percent or null." });
    } else {
      contractAggregateCap = value.contractAggregateCap;
    }
  }
  if (!Array.isArray(value.scopes)) {
    errors.push({ field: "scopes", message: "Add at least one scope." });
    return undefined;
  }
  const scopes: ContractScope[] = [];
  const seen = new Set<string>();
  for (const [index, entry] of value.scopes.entries()) {
    const scope = parseScope(entry, index, errors);
    if (scope === undefined) {
      continue;
    }
    if (seen.has(scope.scopeId)) {
      errors.push({ field: `scopes.${scope.scopeId}.scopeId`, message: "Scope ids must be unique." });
      continue;
    }
    seen.add(scope.scopeId);
    scopes.push(scope);
  }
  if (errors.length > 0) {
    return undefined;
  }
  return { effectiveFrom, effectiveTo, scopes, contractAggregateCap };
}

function parseScope(value: unknown, index: number, errors: FieldIssue[]): ContractScope | undefined {
  if (!isRecord(value)) {
    errors.push({ field: "scopes", message: `Scope ${index + 1} must be an object.` });
    return undefined;
  }
  const scopeId = typeof value.scopeId === "string" && value.scopeId.trim() !== "" ? value.scopeId : "";
  const field = (suffix: string) => (scopeId === "" ? `scopes.${index}.${suffix}` : `scopes.${scopeId}.${suffix}`);
  if (scopeId === "") {
    errors.push({ field: field("scopeId"), message: "Each scope needs an id." });
    return undefined;
  }
  if (value.kind !== "service" && value.kind !== "catch_all") {
    errors.push({ field: field("kind"), message: "Choose specific services or general." });
    return undefined;
  }
  if (typeof value.target !== "number") {
    errors.push({ field: field("target"), message: "Enter a target." });
    return undefined;
  }
  const penalty = parsePenalty(value.penalty, field);
  if (!penalty.ok) {
    errors.push(penalty.issue);
    return undefined;
  }
  const sourceClause = typeof value.sourceClause === "string" ? value.sourceClause : "";
  if (value.kind === "catch_all") {
    if (typeof value.includesScopedServices !== "boolean") {
      errors.push({
        field: field("includesScopedServices"),
        message:
          "Choose yes or no. This target needs to say whether outages in services named in other scopes also count.",
      });
      return undefined;
    }
    return {
      kind: "catch_all",
      scopeId,
      includesScopedServices: value.includesScopedServices,
      target: value.target,
      penalty: penalty.penalty,
      sourceClause,
    };
  }
  if (!Array.isArray(value.services) || value.services.some((service) => typeof service !== "string")) {
    errors.push({ field: field("services"), message: "Select at least one service." });
    return undefined;
  }
  return {
    kind: "service",
    scopeId,
    services: value.services as ServiceId[],
    target: value.target,
    penalty: penalty.penalty,
    sourceClause,
  };
}

function parsePenalty(
  value: unknown,
  field: (suffix: string) => string,
): { ok: true; penalty: ContractPenalty } | { ok: false; issue: FieldIssue } {
  if (!isRecord(value) || (value.kind !== "none" && value.kind !== "not_entered" && value.kind !== "tiers")) {
    return { ok: false, issue: { field: field("penalty"), message: "Choose a penalty." } };
  }
  if (value.kind === "none" || value.kind === "not_entered") {
    return { ok: true, penalty: { kind: value.kind } };
  }
  if (!Array.isArray(value.tiers)) {
    return { ok: false, issue: { field: field("tiers"), message: "Tiers must be a list." } };
  }
  const tiers: { atOrAbove: number; credit: number }[] = [];
  for (const row of value.tiers) {
    if (!isRecord(row) || typeof row.atOrAbove !== "number" || typeof row.credit !== "number") {
      return {
        ok: false,
        issue: { field: field("tiers"), message: "Each tier needs an at or above % and a credit %." },
      };
    }
    tiers.push({ atOrAbove: row.atOrAbove, credit: row.credit });
  }
  let perScopeCap: number | null = null;
  if (value.perScopeCap !== null && value.perScopeCap !== undefined) {
    if (typeof value.perScopeCap !== "number") {
      return { ok: false, issue: { field: field("perScopeCap"), message: "Per-scope cap must be a percent or null." } };
    }
    perScopeCap = value.perScopeCap;
  }
  return { ok: true, penalty: { kind: "tiers", tiers, perScopeCap } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
