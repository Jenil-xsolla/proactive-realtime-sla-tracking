"use client";

import { useMemo, useState } from "react";
import { SERVICES, type PartnerId } from "@/registry";
import {
  contractBodyFromForm,
  emptyScope,
  nextScopeId,
  reviewContractForm,
  type ContractFormScope,
  type ContractFormState,
  type ContractFormTier,
  type FieldIssue,
} from "@/terms/review-contract";
import { Button, Field, TextArea, TextInput } from "@/ui";

const serviceOptions = [...SERVICES].sort((left, right) => left.displayName.localeCompare(right.displayName));

type SaveResult =
  | { kind: "saved"; version: number }
  | { kind: "conflict" }
  | { kind: "invalid"; errors: FieldIssue[] }
  | { kind: "not_found" };

export function TermsForm({
  partner,
  partnerName,
  initial,
  onSaved,
  onReload,
}: {
  partner: PartnerId;
  partnerName: string;
  initial: ContractFormState;
  onSaved?: () => void;
  onReload?: () => void;
}) {
  const [form, setForm] = useState(initial);
  const [dirty, setDirty] = useState<ReadonlySet<string>>(new Set());
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<FieldIssue[]>([]);
  const [conflict, setConflict] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const review = useMemo(() => reviewContractForm(partner, form), [partner, form]);

  function message(field: string): string | undefined {
    const server = serverErrors.find((issue) => issue.field === field)?.message;
    if (server !== undefined) {
      return server;
    }
    if (!submitAttempted && !dirty.has(field)) {
      return undefined;
    }
    return review.errors.find((issue) => issue.field === field)?.message;
  }

  function warning(field: string): string | undefined {
    return review.warnings.find((issue) => issue.field === field)?.message;
  }

  function edit(fields: string[], update: (current: ContractFormState) => ContractFormState) {
    setDirty((current) => {
      const next = new Set(current);
      for (const field of fields) {
        next.add(field);
      }
      return next;
    });
    setServerErrors([]);
    setConfirming(false);
    setFailure(null);
    setForm(update);
  }

  function editScope(scopeId: string, fields: string[], patch: Partial<ContractFormScope>) {
    edit(fields, (current) => ({
      ...current,
      scopes: current.scopes.map((scope) => (scope.scopeId === scopeId ? { ...scope, ...patch } : scope)),
    }));
  }

  async function save(lifecycle: "terms_pending_review" | "contract_bound") {
    setSubmitAttempted(true);
    setConfirming(false);
    if (review.errors.length > 0) {
      return;
    }
    const terms = contractBodyFromForm(form);
    if (terms === null) {
      return;
    }
    setBusy(true);
    setFailure(null);
    try {
      const response = await fetch(`/api/sla/contract-terms/${partner}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        cache: "no-store",
        body: JSON.stringify({
          expectedVersion: form.expectedVersion,
          lifecycle,
          updatedBy: form.updatedBy,
          terms,
        }),
      });
      const body = (await response.json()) as SaveResult;
      if (body.kind === "conflict") {
        setConflict(true);
        return;
      }
      if (body.kind === "invalid") {
        setServerErrors(body.errors);
        return;
      }
      if (body.kind === "saved") {
        onSaved?.();
        return;
      }
      setFailure("The save failed. The terms were not saved.");
    } catch {
      setFailure("The save failed. The terms were not saved.");
    } finally {
      setBusy(false);
    }
  }

  function requestActivate() {
    setSubmitAttempted(true);
    if (review.errors.length > 0) {
      return;
    }
    setConfirming(true);
  }

  return (
    <form
      className="flex flex-col gap-6"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
      }}
    >
      <div className="flex flex-col gap-1">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contract terms</p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {form.expectedVersion === null ? "Add contract terms" : "Edit contract terms"}
        </h1>
        <p className="text-sm text-muted-foreground">{partnerName}</p>
      </div>

      {conflict ? (
        <div className="flex flex-col items-start gap-3 rounded border border-border bg-muted p-4" role="alert">
          <p className="text-sm text-foreground">Someone else changed these terms.</p>
          <Button type="button" onClick={() => onReload?.()}>
            Reload
          </Button>
        </div>
      ) : null}
      {failure ? (
        <p className="text-sm text-danger" role="alert">
          {failure}
        </p>
      ) : null}
      {message("form") ? (
        <p className="text-sm text-danger" role="alert">
          {message("form")}
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Effective from"
          htmlFor="effective-from"
          field="effectiveFrom"
          error={message("effectiveFrom")}
        >
          <TextInput
            id="effective-from"
            type="date"
            value={form.effectiveFrom}
            {...described("effective-from", message("effectiveFrom"))}
            onChange={(event) => {
              const value = event.target.value;
              edit(["effectiveFrom"], (current) => ({ ...current, effectiveFrom: value }));
            }}
          />
        </Field>
        <Field label="Effective to" htmlFor="effective-to" field="effectiveTo" error={message("effectiveTo")}>
          <TextInput
            id="effective-to"
            type="date"
            value={form.effectiveTo}
            {...described("effective-to", message("effectiveTo"))}
            onChange={(event) => {
              const value = event.target.value;
              edit(["effectiveTo"], (current) => ({ ...current, effectiveTo: value }));
            }}
          />
        </Field>
      </div>
      <p className="text-sm text-muted-foreground">Effective to is optional.</p>
      {message("scopes") ? (
        <p className="text-sm text-danger" role="alert">
          {message("scopes")}
        </p>
      ) : null}

      {form.scopes.map((scope, index) => (
        <ScopeFields
          key={scope.scopeId}
          index={index}
          scope={scope}
          canRemove={form.scopes.length > 1}
          message={message}
          warning={warning}
          onPatch={(fields, patch) => editScope(scope.scopeId, fields, patch)}
          onRemove={() => {
            edit(["scopes"], (current) => ({
              ...current,
              scopes: current.scopes.filter((item) => item.scopeId !== scope.scopeId),
            }));
          }}
        />
      ))}

      <div>
        <Button
          type="button"
          onClick={() => {
            edit(["scopes"], (current) => ({
              ...current,
              scopes: [...current.scopes, emptyScope(nextScopeId(current.scopes))],
            }));
          }}
        >
          Add scope
        </Button>
      </div>

      <Field label="Your name" htmlFor="updated-by" field="updatedBy" error={message("updatedBy")}>
        <TextInput
          id="updated-by"
          type="text"
          autoComplete="name"
          value={form.updatedBy}
          {...described("updated-by", message("updatedBy"))}
          onChange={(event) => {
            const value = event.target.value;
            edit(["updatedBy"], (current) => ({ ...current, updatedBy: value }));
          }}
        />
      </Field>
      <p className="text-sm text-muted-foreground">Your name is recorded with this save.</p>

      {confirming ? (
        <div className="flex flex-col items-start gap-4 rounded border border-border p-4">
          <p className="text-sm text-foreground">
            Activate contract terms for {partnerName}? This starts scoring.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button type="button" variant="primary" disabled={busy} onClick={() => void save("contract_bound")}>
              Activate
            </Button>
            <Button type="button" disabled={busy} onClick={() => setConfirming(false)}>
              Back
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-3">
          <Button type="button" disabled={busy} onClick={() => void save("terms_pending_review")}>
            Save draft
          </Button>
          <Button type="button" variant="primary" disabled={busy} onClick={requestActivate}>
            Activate
          </Button>
        </div>
      )}
    </form>
  );
}

function described(id: string, error?: string, warning?: string) {
  if (error) {
    return { "aria-invalid": true as const, "aria-describedby": `${id}-error` };
  }
  if (warning) {
    return { "aria-describedby": `${id}-warning` };
  }
  return {};
}

function ScopeFields({
  index,
  scope,
  canRemove,
  message,
  warning,
  onPatch,
  onRemove,
}: {
  index: number;
  scope: ContractFormScope;
  canRemove: boolean;
  message: (field: string) => string | undefined;
  warning: (field: string) => string | undefined;
  onPatch: (fields: string[], patch: Partial<ContractFormScope>) => void;
  onRemove: () => void;
}) {
  const field = (suffix: string) => `scopes.${scope.scopeId}.${suffix}`;
  const targetId = `target-${scope.scopeId}`;
  const sourceId = `source-${scope.scopeId}`;
  return (
    <section className="flex flex-col gap-4 rounded border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Scope {index + 1}</h2>
        {canRemove ? (
          <Button type="button" onClick={onRemove}>
            Remove scope
          </Button>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-2" data-field={field("kind")}>
        <legend className="text-sm font-medium text-foreground">Coverage</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`kind-${scope.scopeId}`}
            checked={scope.kind === "service"}
            onChange={() => onPatch([field("kind")], { kind: "service" })}
          />
          Specific services
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`kind-${scope.scopeId}`}
            checked={scope.kind === "catch_all"}
            onChange={() => onPatch([field("kind")], { kind: "catch_all" })}
          />
          General
        </label>
        {message(field("kind")) ? (
          <p className="text-sm text-danger" role="alert">
            {message(field("kind"))}
          </p>
        ) : null}
      </fieldset>

      {scope.kind === "service" ? (
        <fieldset className="flex flex-col gap-2" data-field={field("services")}>
          <legend className="text-sm font-medium text-foreground">Services</legend>
          <p className="text-sm text-muted-foreground">Selected services share one target.</p>
          <div className="flex max-h-60 flex-col gap-2 overflow-y-auto rounded border border-border p-3">
            {serviceOptions.map((service) => (
              <label key={service.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={scope.services.includes(service.id)}
                  onChange={(event) => {
                    const services = event.target.checked
                      ? [...scope.services, service.id]
                      : scope.services.filter((id) => id !== service.id);
                    onPatch([field("services")], { services });
                  }}
                />
                {service.displayName}
              </label>
            ))}
          </div>
          {message(field("services")) ? (
            <p className="text-sm text-danger" role="alert">
              {message(field("services"))}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      {scope.kind === "catch_all" ? (
        <fieldset className="flex flex-col gap-2" data-field={field("includesScopedServices")}>
          <legend className="text-sm font-medium text-foreground">
            Do outages in services named in other scopes also count against this target?
          </legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`includes-${scope.scopeId}`}
              checked={scope.includesScopedServices === "yes"}
              onChange={() => onPatch([field("includesScopedServices")], { includesScopedServices: "yes" })}
            />
            Yes
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name={`includes-${scope.scopeId}`}
              checked={scope.includesScopedServices === "no"}
              onChange={() => onPatch([field("includesScopedServices")], { includesScopedServices: "no" })}
            />
            No
          </label>
          {message(field("includesScopedServices")) ? (
            <p className="text-sm text-danger" role="alert">
              {message(field("includesScopedServices"))}
            </p>
          ) : null}
        </fieldset>
      ) : null}

      <Field label="Target %" htmlFor={targetId} field={field("target")} error={message(field("target"))}>
        <TextInput
          id={targetId}
          inputMode="decimal"
          value={scope.target}
          {...described(targetId, message(field("target")))}
          onChange={(event) => onPatch([field("target")], { target: event.target.value })}
        />
      </Field>

      <fieldset className="flex flex-col gap-2" data-field={field("penalty")}>
        <legend className="text-sm font-medium text-foreground">Penalty</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`penalty-${scope.scopeId}`}
            checked={scope.penaltyKind === "none"}
            onChange={() => onPatch([field("penalty")], { penaltyKind: "none" })}
          />
          No penalty clause
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`penalty-${scope.scopeId}`}
            checked={scope.penaltyKind === "not_entered"}
            onChange={() => onPatch([field("penalty")], { penaltyKind: "not_entered" })}
          />
          Penalty exists, not entered
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="radio"
            name={`penalty-${scope.scopeId}`}
            checked={scope.penaltyKind === "tiers"}
            onChange={() => onPatch([field("penalty")], { penaltyKind: "tiers" })}
          />
          Tiers
        </label>
        {message(field("penalty")) ? (
          <p className="text-sm text-danger" role="alert">
            {message(field("penalty"))}
          </p>
        ) : null}
      </fieldset>

      {scope.penaltyKind === "tiers" ? (
        <div className="flex flex-col gap-3" data-field={field("tiers")}>
          <p className="text-sm text-muted-foreground">Highest band first. The last band stays at 0%.</p>
          {scope.tiers.map((tier, tierIndex) => (
            <TierRow
              key={`${scope.scopeId}-${tierIndex}`}
              scopeId={scope.scopeId}
              index={tierIndex}
              tier={tier}
              atOrAboveError={message(`${field("tiers")}.${tierIndex}.atOrAbove`)}
              creditError={message(`${field("tiers")}.${tierIndex}.credit`)}
              onChange={(patch) => {
                const tiers = scope.tiers.map((row, rowIndex) =>
                  rowIndex === tierIndex ? { ...row, ...patch } : row,
                );
                onPatch(
                  [`${field("tiers")}.${tierIndex}.atOrAbove`, `${field("tiers")}.${tierIndex}.credit`, field("tiers")],
                  { tiers },
                );
              }}
              onRemove={() => {
                onPatch([field("tiers")], {
                  tiers: scope.tiers.filter((_, rowIndex) => rowIndex !== tierIndex),
                });
              }}
            />
          ))}
          {message(field("tiers")) ? (
            <p className="text-sm text-danger" role="alert">
              {message(field("tiers"))}
            </p>
          ) : null}
          <div>
            <Button
              type="button"
              onClick={() => {
                const insertAt = Math.max(scope.tiers.length - 1, 0);
                const tiers = [...scope.tiers];
                tiers.splice(insertAt, 0, { atOrAbove: "", credit: "", fixed: false });
                onPatch([field("tiers")], { tiers });
              }}
            >
              Add band
            </Button>
          </div>
        </div>
      ) : null}

      <Field
        label="Source clause"
        htmlFor={sourceId}
        field={field("sourceClause")}
        warning={warning(field("sourceClause"))}
      >
        <TextArea
          id={sourceId}
          rows={3}
          value={scope.sourceClause}
          {...described(sourceId, undefined, warning(field("sourceClause")))}
          onChange={(event) => onPatch([field("sourceClause")], { sourceClause: event.target.value })}
        />
      </Field>
    </section>
  );
}

function TierRow({
  scopeId,
  index,
  tier,
  atOrAboveError,
  creditError,
  onChange,
  onRemove,
}: {
  scopeId: string;
  index: number;
  tier: ContractFormTier;
  atOrAboveError?: string;
  creditError?: string;
  onChange: (patch: Partial<ContractFormTier>) => void;
  onRemove: () => void;
}) {
  const atId = `at-${scopeId}-${index}`;
  const creditId = `credit-${scopeId}-${index}`;
  return (
    <div className="grid items-end gap-3 sm:grid-cols-[1fr_1fr_auto]">
      <Field
        label="At or above %"
        htmlFor={atId}
        field={`${scopeId}-tier-${index}-at`}
        error={atOrAboveError}
      >
        <TextInput
          id={atId}
          inputMode="decimal"
          readOnly={tier.fixed}
          value={tier.atOrAbove}
          {...described(atId, atOrAboveError)}
          onChange={(event) => {
            if (!tier.fixed) {
              onChange({ atOrAbove: event.target.value });
            }
          }}
        />
      </Field>
      <Field label="Credit %" htmlFor={creditId} field={`${scopeId}-tier-${index}-credit`} error={creditError}>
        <TextInput
          id={creditId}
          inputMode="decimal"
          value={tier.credit}
          {...described(creditId, creditError)}
          onChange={(event) => onChange({ credit: event.target.value })}
        />
      </Field>
      {tier.fixed ? (
        <span className="pb-2 text-sm text-muted-foreground">Fixed at 0%</span>
      ) : (
        <Button type="button" onClick={onRemove}>
          Remove band
        </Button>
      )}
    </div>
  );
}
