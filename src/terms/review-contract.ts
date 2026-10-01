import type { PartnerId } from "@/registry";
import { loadContractFile } from "./load-contract";
import type { ContractFile, ContractPenalty, ContractScope, ContractTermsBody } from "./types";

export type FieldIssue = {
  field: string;
  message: string;
};

export type ContractReview = {
  errors: FieldIssue[];
  warnings: FieldIssue[];
};

const SOURCE_CLAUSE_WARNING = "No source clause. Every figure should trace to contract language.";

/**
 * A file used only to ask `loadContractFile` about one field. It is never
 * saved and never rendered. The stand-in date and target let the loader
 * reach the field under test.
 */
function probeFile(partner: PartnerId, overrides: Partial<ContractFile>): ContractFile {
  return {
    partner,
    lifecycle: "terms_pending_review",
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    contractAggregateCap: null,
    scopes: [
      {
        kind: "service",
        scopeId: "probe",
        services: ["payments"],
        target: 100,
        penalty: { kind: "none" },
        sourceClause: "probe",
      },
    ],
    ...overrides,
  };
}

function loadMessage(file: ContractFile): string | null {
  try {
    loadContractFile(file);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Contract terms could not be validated.";
  }
}

export function fieldForLoadMessage(message: string): string {
  if (message.startsWith("effectiveFrom")) {
    return "effectiveFrom";
  }
  if (message.startsWith("effectiveTo")) {
    return "effectiveTo";
  }
  if (message.includes("contractAggregateCap")) {
    return "contractAggregateCap";
  }
  const match = /^Scope "([^"]*)"/.exec(message);
  if (match) {
    const id = match[1] ?? "";
    if (message.includes("target must")) {
      return `scopes.${id}.target`;
    }
    if (message.includes("includesScopedServices")) {
      return `scopes.${id}.includesScopedServices`;
    }
    if (message.includes("kind must")) {
      return `scopes.${id}.kind`;
    }
    if (message.includes("at least one service") || message.includes("not a registry")) {
      return `scopes.${id}.services`;
    }
    if (message.includes("penalty kind")) {
      return `scopes.${id}.penalty`;
    }
    if (message.includes("perScopeCap")) {
      return `scopes.${id}.perScopeCap`;
    }
    if (message.includes("tier") || message.includes("atOrAbove")) {
      return `scopes.${id}.tiers`;
    }
    if (message.includes("sourceClause")) {
      return `scopes.${id}.sourceClause`;
    }
  }
  if (message.includes("updatedBy")) {
    return "updatedBy";
  }
  return "form";
}

function pushError(errors: FieldIssue[], field: string, message: string) {
  if (errors.some((issue) => issue.field === field)) {
    return;
  }
  errors.push({ field, message });
}

/**
 * Runs `loadContractFile` on a stored contract body. Empty source clauses
 * are warnings. Anything the loader throws is an error on the field it names.
 */
export function reviewStoredTerms(
  partner: PartnerId,
  lifecycle: ContractFile["lifecycle"],
  terms: ContractTermsBody,
  updatedBy: string,
): ContractReview {
  const errors: FieldIssue[] = [];
  const warnings: FieldIssue[] = [];
  if (updatedBy.trim() === "") {
    pushError(errors, "updatedBy", "Enter your name.");
  }
  if (!Array.isArray(terms.scopes) || terms.scopes.length === 0) {
    pushError(errors, "scopes", "Add at least one scope.");
  }

  const file: ContractFile = {
    partner,
    lifecycle,
    effectiveFrom: terms.effectiveFrom,
    effectiveTo: terms.effectiveTo,
    scopes: terms.scopes,
    contractAggregateCap: terms.contractAggregateCap,
  };
  try {
    const loaded = loadContractFile(file);
    for (const warning of loaded.warnings) {
      if (warning.includes("sourceClause")) {
        const field = fieldForLoadMessage(warning);
        if (!warnings.some((issue) => issue.field === field)) {
          warnings.push({ field, message: SOURCE_CLAUSE_WARNING });
        }
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Contract terms could not be validated.";
    pushError(errors, fieldForLoadMessage(message), message);
  }
  return { errors, warnings };
}

export type ContractFormTier = {
  atOrAbove: string;
  credit: string;
  /** The closing band. Its at-or-above value stays 0. */
  fixed: boolean;
};

export type ContractFormScope = {
  scopeId: string;
  kind: "" | "service" | "catch_all";
  services: string[];
  includesScopedServices: "" | "yes" | "no";
  target: string;
  penaltyKind: "" | ContractPenalty["kind"];
  tiers: ContractFormTier[];
  perScopeCap: number | null;
  sourceClause: string;
};

export type ContractFormState = {
  effectiveFrom: string;
  effectiveTo: string;
  contractAggregateCap: number | null;
  scopes: ContractFormScope[];
  updatedBy: string;
  expectedVersion: number | null;
};

export function emptyScope(scopeId: string): ContractFormScope {
  return {
    scopeId,
    kind: "",
    services: [],
    includesScopedServices: "",
    target: "",
    penaltyKind: "",
    tiers: [{ atOrAbove: "0", credit: "", fixed: true }],
    perScopeCap: null,
    sourceClause: "",
  };
}

export function emptyContractForm(): ContractFormState {
  return {
    effectiveFrom: "",
    effectiveTo: "",
    contractAggregateCap: null,
    scopes: [emptyScope("scope-1")],
    updatedBy: "",
    expectedVersion: null,
  };
}

export function nextScopeId(scopes: readonly { scopeId: string }[]): string {
  const used = new Set(scopes.map((scope) => scope.scopeId));
  let n = scopes.length + 1;
  while (used.has(`scope-${n}`)) {
    n += 1;
  }
  return `scope-${n}`;
}

function parsePercent(value: string): number | null {
  const trimmed = value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    return null;
  }
  const number = Number(trimmed);
  return Number.isFinite(number) ? number : null;
}

function probeDate(partner: PartnerId, field: "effectiveFrom" | "effectiveTo", value: string): string | null {
  const message = loadMessage(
    probeFile(partner, {
      effectiveFrom: field === "effectiveFrom" ? value : "2026-01-01",
      effectiveTo: field === "effectiveTo" ? value : null,
    }),
  );
  if (message !== null && message.startsWith(field)) {
    return message;
  }
  return null;
}

function serviceScope(scopeId: string, services: ContractScope["services"], target = 100): ContractScope {
  return {
    kind: "service",
    scopeId,
    services,
    target,
    penalty: { kind: "none" },
    sourceClause: "probe",
  };
}

/**
 * Same rules as `loadContractFile`, reported per field so the form can show
 * them while the values are being typed. A blank required field is an error.
 * An empty source clause is a warning.
 */
export function reviewContractForm(partner: PartnerId, form: ContractFormState): ContractReview {
  const errors: FieldIssue[] = [];
  const warnings: FieldIssue[] = [];

  if (form.updatedBy.trim() === "") {
    pushError(errors, "updatedBy", "Enter your name.");
  }
  if (form.effectiveFrom.trim() === "") {
    pushError(errors, "effectiveFrom", "Effective from is required.");
  } else {
    const message = probeDate(partner, "effectiveFrom", form.effectiveFrom.trim());
    if (message !== null) {
      pushError(errors, "effectiveFrom", message);
    }
  }
  if (form.effectiveTo.trim() !== "") {
    const message = probeDate(partner, "effectiveTo", form.effectiveTo.trim());
    if (message !== null) {
      pushError(errors, "effectiveTo", message);
    }
  }
  if (form.scopes.length === 0) {
    pushError(errors, "scopes", "Add at least one scope.");
  }

  for (const scope of form.scopes) {
    reviewScope(partner, scope, errors, warnings);
  }

  const terms = contractBodyFromForm(form);
  if (terms !== null) {
    const stored = reviewStoredTerms(partner, "terms_pending_review", terms, form.updatedBy);
    for (const error of stored.errors) {
      pushError(errors, error.field, error.message);
    }
    for (const warning of stored.warnings) {
      if (!warnings.some((issue) => issue.field === warning.field)) {
        warnings.push(warning);
      }
    }
  }

  return { errors, warnings };
}

function reviewScope(
  partner: PartnerId,
  scope: ContractFormScope,
  errors: FieldIssue[],
  warnings: FieldIssue[],
) {
  const field = (suffix: string) => `scopes.${scope.scopeId}.${suffix}`;

  if (scope.kind === "") {
    pushError(errors, field("kind"), "Choose specific services or general.");
  } else if (scope.kind === "service") {
    if (scope.services.length === 0) {
      pushError(errors, field("services"), "Select at least one service.");
    } else {
      const message = loadMessage(
        probeFile(partner, {
          scopes: [serviceScope(scope.scopeId, scope.services as ContractScope["services"])],
        }),
      );
      if (message !== null && fieldForLoadMessage(message) === field("services")) {
        pushError(errors, field("services"), message);
      }
    }
  } else if (scope.includesScopedServices === "") {
    pushError(
      errors,
      field("includesScopedServices"),
      "Choose yes or no. This target needs to say whether outages in services named in other scopes also count.",
    );
  }

  if (scope.target.trim() === "") {
    pushError(errors, field("target"), "Enter a target.");
  } else {
    const target = parsePercent(scope.target);
    if (target === null) {
      pushError(errors, field("target"), "Enter a percent.");
    } else {
      const message = loadMessage(
        probeFile(partner, { scopes: [serviceScope(scope.scopeId, ["payments"], target)] }),
      );
      if (message !== null && message.includes("target must")) {
        pushError(errors, field("target"), message);
      }
    }
  }

  if (scope.penaltyKind === "") {
    pushError(errors, field("penalty"), "Choose a penalty.");
  } else if (scope.penaltyKind === "tiers") {
    reviewTiers(partner, scope, errors);
  }

  if (scope.sourceClause.trim() === "") {
    warnings.push({ field: field("sourceClause"), message: SOURCE_CLAUSE_WARNING });
  }
}

function reviewTiers(partner: PartnerId, scope: ContractFormScope, errors: FieldIssue[]) {
  const field = `scopes.${scope.scopeId}.tiers`;
  const parsed: { atOrAbove: number; credit: number }[] = [];
  for (const [index, tier] of scope.tiers.entries()) {
    const atOrAbove = parsePercent(tier.atOrAbove);
    const credit = parsePercent(tier.credit);
    if (atOrAbove === null) {
      pushError(errors, `${field}.${index}.atOrAbove`, "Enter an at or above %.");
    }
    if (credit === null) {
      pushError(errors, `${field}.${index}.credit`, "Enter a credit %.");
    }
    if (atOrAbove !== null && credit !== null) {
      parsed.push({ atOrAbove, credit });
    }
  }
  if (parsed.length !== scope.tiers.length) {
    return;
  }
  const message = loadMessage(
    probeFile(partner, {
      scopes: [
        {
          kind: "service",
          scopeId: scope.scopeId,
          services: ["payments"],
          target: 100,
          penalty: { kind: "tiers", tiers: parsed, perScopeCap: scope.perScopeCap },
          sourceClause: "probe",
        },
      ],
    }),
  );
  if (message !== null && fieldForLoadMessage(message) === field) {
    pushError(errors, field, message);
  }
}

/** Null when the form is still incomplete. Callers save only after review reports no errors. */
export function contractBodyFromForm(form: ContractFormState): ContractTermsBody | null {
  if (form.scopes.length === 0) {
    return null;
  }
  const scopes: ContractScope[] = [];
  for (const scope of form.scopes) {
    const built = scopeFromForm(scope);
    if (built === null) {
      return null;
    }
    scopes.push(built);
  }
  if (form.effectiveFrom.trim() === "") {
    return null;
  }
  return {
    effectiveFrom: form.effectiveFrom.trim(),
    effectiveTo: form.effectiveTo.trim() === "" ? null : form.effectiveTo.trim(),
    contractAggregateCap: form.contractAggregateCap,
    scopes,
  };
}

function scopeFromForm(scope: ContractFormScope): ContractScope | null {
  const target = parsePercent(scope.target);
  if (target === null || (scope.kind !== "service" && scope.kind !== "catch_all")) {
    return null;
  }
  const penalty = penaltyFromForm(scope);
  if (penalty === null) {
    return null;
  }
  const sourceClause = scope.sourceClause.trim();
  if (scope.kind === "catch_all") {
    if (scope.includesScopedServices === "") {
      return null;
    }
    return {
      kind: "catch_all",
      scopeId: scope.scopeId,
      includesScopedServices: scope.includesScopedServices === "yes",
      target,
      penalty,
      sourceClause,
    };
  }
  if (scope.services.length === 0) {
    return null;
  }
  return {
    kind: "service",
    scopeId: scope.scopeId,
    services: scope.services as ContractScope["services"],
    target,
    penalty,
    sourceClause,
  };
}

function penaltyFromForm(scope: ContractFormScope): ContractPenalty | null {
  if (scope.penaltyKind === "none" || scope.penaltyKind === "not_entered") {
    return { kind: scope.penaltyKind };
  }
  if (scope.penaltyKind !== "tiers") {
    return null;
  }
  const tiers: { atOrAbove: number; credit: number }[] = [];
  for (const tier of scope.tiers) {
    const atOrAbove = parsePercent(tier.atOrAbove);
    const credit = parsePercent(tier.credit);
    if (atOrAbove === null || credit === null) {
      return null;
    }
    tiers.push({ atOrAbove, credit });
  }
  return { kind: "tiers", tiers, perScopeCap: scope.perScopeCap };
}
