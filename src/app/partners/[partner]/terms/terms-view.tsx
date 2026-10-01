import { formatUtcTimestamp } from "@/app/dashboard/copy";
import { serviceLabel } from "@/feed";
import type { ContractScope } from "@/terms";
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from "@/ui";

export function TermsView({
  partner,
  partnerName,
  lifecycle,
  updatedBy,
  updatedAt,
  terms,
}: {
  partner: string;
  partnerName: string;
  lifecycle: string;
  updatedBy: string;
  updatedAt: string;
  terms: {
    effectiveFrom: string;
    effectiveTo: string | null;
    scopes: ContractScope[];
  };
}) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Contract terms</p>
          <h1 className="text-2xl font-semibold tracking-tight">{partnerName}</h1>
        </div>
        <a
          href={`/partners/${partner}/terms?edit=1`}
          className="inline-flex items-center justify-center rounded border border-border bg-secondary px-3 py-2 text-sm font-medium text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
        >
          Edit
        </a>
      </div>
      <p className="text-sm text-foreground">{lifecycleLabel(lifecycle)}</p>
      <dl className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Effective from</dt>
          <dd className="font-mono text-sm tabular-nums">{terms.effectiveFrom}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Effective to</dt>
          <dd className="font-mono text-sm tabular-nums">{terms.effectiveTo ?? "No end date"}</dd>
        </div>
      </dl>
      <div className="flex flex-col gap-4">
        {terms.scopes.map((scope, index) => (
          <ScopeReadout key={scope.scopeId} index={index} scope={scope} />
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Last saved by {updatedBy} at {formatUtcTimestamp(updatedAt)}
      </p>
    </div>
  );
}

function lifecycleLabel(lifecycle: string): string {
  if (lifecycle === "contract_bound") {
    return "Active. These terms are scoring.";
  }
  if (lifecycle === "terms_pending_review") {
    return "Draft. These terms are not scoring.";
  }
  return lifecycle;
}

function ScopeReadout({ index, scope }: { index: number; scope: ContractScope }) {
  return (
    <section className="flex flex-col gap-4 rounded border border-border p-4">
      <h2 className="text-lg font-semibold tracking-tight">Scope {index + 1}</h2>
      <dl className="grid gap-4">
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Coverage</dt>
          <dd className="text-sm">{coverageText(scope)}</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Target</dt>
          <dd className="font-mono text-sm tabular-nums">{scope.target}%</dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Penalty</dt>
          <dd className="text-sm">{penaltyText(scope)}</dd>
        </div>
        {scope.penalty.kind === "tiers" ? <TierTable scope={scope} /> : null}
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Source clause</dt>
          <dd className="text-sm">{sourceClauseText(scope)}</dd>
        </div>
      </dl>
    </section>
  );
}

function sourceClauseText(scope: ContractScope) {
  const clause = scope.sourceClause?.trim() ?? "";
  if (clause !== "") {
    return clause;
  }
  return (
    <span className="text-warning">No source clause. Every figure should trace to contract language.</span>
  );
}

function coverageText(scope: ContractScope): string {
  if (scope.kind === "catch_all") {
    const answer =
      scope.includesScopedServices === true
        ? "Yes. Outages in services named in other scopes also count against this target."
        : scope.includesScopedServices === false
          ? "No. Outages in services named in other scopes do not count against this target."
          : "Not answered.";
    return `General. ${answer}`;
  }
  const names = (scope.services ?? []).map((id) => serviceLabel(id)).join(", ");
  return `Specific services, one combined target: ${names}`;
}

function penaltyText(scope: ContractScope): string {
  if (scope.penalty.kind === "none") {
    return "No penalty clause";
  }
  if (scope.penalty.kind === "not_entered") {
    return "Penalty exists, not entered";
  }
  return "Tiers";
}

function TierTable({ scope }: { scope: ContractScope }) {
  if (scope.penalty.kind !== "tiers") {
    return null;
  }
  const tiers = scope.penalty.tiers;
  return (
    <Table caption={`Penalty tiers for scope ${scope.scopeId}`}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>At or above %</TableHeaderCell>
          <TableHeaderCell numeric>Credit %</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {tiers.map((tier, index) => (
          <TableRow key={`${index}-${tier.atOrAbove}`}>
            <TableCell>{tier.atOrAbove}</TableCell>
            <TableCell numeric>{tier.credit}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
