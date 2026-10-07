import { Card } from "@/ui";
import { INGESTION_FAILED_LABEL, INGESTION_HEALTH_UNAVAILABLE, INGESTION_UNRESOLVED_LABEL, INGESTION_WITHOUT_MESSAGE_LABEL, INVALID_CONTRACT_TERMS_LABEL, ZERO_COVERAGE_NOTE } from "./copy";
import type { HealthView, IngestionRow } from "./model";

export function HealthPanel({ health }: { health: HealthView }) {
  const ingestion = health.ingestion;
  return (
    <section aria-labelledby="data-health-heading">
      <Card>
        <div className="flex flex-col gap-4">
          <h2 id="data-health-heading" className="text-lg font-semibold tracking-tight">
            Data health
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Metric
              label="Dropped rows"
              value={String(health.droppedRows)}
              detail={`of ${health.usableCount + health.droppedRows} rows in the extract`}
              warn={health.droppedRows > 0}
            />
            <Metric
              label="Unresolved partners"
              value={String(health.unresolvedPartnerNames.length)}
              warn={health.unresolvedPartnerNames.length > 0}
            />
            <Metric
              label="Unmatched services"
              value={String(health.unmatchedServiceNames.length)}
              warn={health.unmatchedServiceNames.length > 0}
            />
            <Metric
              label="Partners with no rows"
              value={String(health.partnersWithNoRows.length)}
              detail={ZERO_COVERAGE_NOTE}
              warn={false}
            />
            <Metric
              label={INVALID_CONTRACT_TERMS_LABEL}
              value={String(health.invalidTerms.length)}
              warn={health.invalidTerms.length > 0}
            />
            {ingestion.status === "ok" ? (
              <>
                <Metric
                  label={INGESTION_FAILED_LABEL}
                  value={String(ingestion.failed.count)}
                  warn={ingestion.failed.count > 0}
                />
                <Metric
                  label={INGESTION_UNRESOLVED_LABEL}
                  value={String(ingestion.unresolved.count)}
                  warn={ingestion.unresolved.count > 0}
                />
                <Metric
                  label={INGESTION_WITHOUT_MESSAGE_LABEL}
                  value={String(ingestion.withoutMessage.count)}
                  warn={ingestion.withoutMessage.count > 0}
                />
              </>
            ) : null}
          </div>
          {ingestion.status === "error" ? (
            <p className="text-sm text-danger" role="alert">
              {INGESTION_HEALTH_UNAVAILABLE}
            </p>
          ) : null}
          {health.reasons.length > 0 ? (
            <ul className="flex flex-col gap-1">
              {health.reasons.map((reason) => (
                <li key={reason.key} className="font-mono text-sm text-warning">
                  {reason.count} {reason.label}
                </li>
              ))}
            </ul>
          ) : null}
          <InvalidTermsList rows={health.invalidTerms} />
          <NameList label="Unresolved partner names" names={health.unresolvedPartnerNames} />
          <NameList label="Unmatched service names" names={health.unmatchedServiceNames} />
          <NameList label="Partners with no attributed rows" names={health.partnersWithNoRows} />
          {ingestion.status === "ok" ? (
            <>
              <IngestionList label={INGESTION_FAILED_LABEL} rows={ingestion.failed.rows} />
              <IngestionList label={INGESTION_UNRESOLVED_LABEL} rows={ingestion.unresolved.rows} />
              <IngestionList label={INGESTION_WITHOUT_MESSAGE_LABEL} rows={ingestion.withoutMessage.rows} />
            </>
          ) : null}
        </div>
      </Card>
    </section>
  );
}

function Metric({
  label,
  value,
  detail,
  warn,
}: {
  label: string;
  value: string;
  detail?: string;
  warn: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className={`font-mono text-2xl tabular-nums ${warn ? "text-warning" : "text-foreground"}`}>{value}</p>
      {detail ? <p className="text-sm text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function InvalidTermsList({
  rows,
}: {
  rows: readonly { partner: string; label: string; message: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {INVALID_CONTRACT_TERMS_LABEL}
      </h3>
      {rows.length === 0 ? (
        <p className="text-sm text-foreground">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.partner} className="text-sm text-warning">
              {row.label}
              <span className="text-muted-foreground"> · {row.message}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NameList({ label, names }: { label: string; names: readonly string[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
      {names.length === 0 ? (
        <p className="text-sm text-foreground">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {names.map((name) => (
            <li key={name} className="text-sm text-foreground">
              {name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IngestionList({ label, rows }: { label: string; rows: readonly IngestionRow[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-foreground">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.pirKey} className="text-sm text-foreground">
              {row.href === null ? (
                <span className="font-mono">{row.pirKey}</span>
              ) : (
                <a
                  href={row.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-mono text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {row.pirKey}
                </a>
              )}
              {row.detail ? <span className="text-muted-foreground"> · {row.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
