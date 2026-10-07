import { Table, TableBody, TableCell, TableHead, TableHeaderCell, Tile } from "@/ui";
import { HEALTH_UNAVAILABLE, INGESTION_FAILED_LABEL, INGESTION_HEALTH_UNAVAILABLE, INGESTION_UNRESOLVED_LABEL, INGESTION_WITHOUT_MESSAGE_LABEL, INVALID_CONTRACT_TERMS_LABEL, ZERO_COVERAGE_NOTE } from "./copy";
import type { HealthView, IngestionRow, UnusableRowView } from "./model";

const HEADING = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

export function HealthPage({ health, unusable }: { health: HealthView | { status: "error" }; unusable: UnusableRowView[] | null }) {
  if ("status" in health) {
    return (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
        <p role="alert" className="text-sm text-danger">{HEALTH_UNAVAILABLE}</p>
      </>
    );
  }
  const ingestion = health.ingestion;
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Health</h1>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Dropped rows" value={String(health.droppedRows)} detail={`of ${health.usableCount + health.droppedRows} rows in the extract`} tone={health.droppedRows > 0 ? "warning" : "neutral"} />
        <Tile label="Unresolved partners" value={String(health.unresolvedPartnerNames.length)} tone={health.unresolvedPartnerNames.length > 0 ? "warning" : "neutral"} />
        <Tile label="Unmatched services" value={String(health.unmatchedServiceNames.length)} tone={health.unmatchedServiceNames.length > 0 ? "warning" : "neutral"} />
        <Tile label="Partners with no rows" value={String(health.partnersWithNoRows.length)} detail={ZERO_COVERAGE_NOTE} />
        <Tile label={INVALID_CONTRACT_TERMS_LABEL} value={String(health.invalidTerms.length)} tone={health.invalidTerms.length > 0 ? "warning" : "neutral"} />
        {ingestion.status === "ok" ? (
          <>
            <Tile label={INGESTION_FAILED_LABEL} value={String(ingestion.failed.count)} tone={ingestion.failed.count > 0 ? "warning" : "neutral"} />
            <Tile label={INGESTION_UNRESOLVED_LABEL} value={String(ingestion.unresolved.count)} tone={ingestion.unresolved.count > 0 ? "warning" : "neutral"} />
            <Tile label={INGESTION_WITHOUT_MESSAGE_LABEL} value={String(ingestion.withoutMessage.count)} tone={ingestion.withoutMessage.count > 0 ? "warning" : "neutral"} />
          </>
        ) : null}
      </div>
      {ingestion.status === "error" ? <p role="alert" className="text-sm text-danger">{INGESTION_HEALTH_UNAVAILABLE}</p> : null}
      {health.reasons.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {health.reasons.map((reason) => (
            <li key={reason.key} className="font-mono text-sm text-warning">{reason.count} {reason.label}</li>
          ))}
        </ul>
      ) : null}
      <section aria-labelledby="unusable-rows-heading" className="flex flex-col gap-2">
        <h2 id="unusable-rows-heading" className="text-lg font-semibold tracking-tight">Unusable rows</h2>
        {unusable === null ? (
          <p role="alert" className="text-sm text-danger">{HEALTH_UNAVAILABLE}</p>
        ) : unusable.length === 0 ? (
          <p className="text-sm text-foreground">None</p>
        ) : (
          <Table caption="Unusable rows">
            <TableHead>
              <tr className="border-b border-border">
                <TableHeaderCell>PIR</TableHeaderCell><TableHeaderCell>Partner</TableHeaderCell><TableHeaderCell>Merchant id</TableHeaderCell><TableHeaderCell>Service</TableHeaderCell><TableHeaderCell>Started</TableHeaderCell><TableHeaderCell>Raw minutes</TableHeaderCell><TableHeaderCell>Reasons</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {unusable.map((row, index) => (
                <tr key={`${row.pirKey}-${index}`} className="border-b border-border last:border-b-0">
                  {/* UnusableRow carries no PIR URL, so the key is plain text here. */}
                  <TableCell className="font-mono">{row.pirKey}</TableCell>
                  <TableCell>{row.partner}</TableCell>
                  <TableCell className="font-mono tabular-nums">{row.merchantId}</TableCell>
                  <TableCell>{row.service}</TableCell>
                  <TableCell className="font-mono tabular-nums">{row.started}</TableCell>
                  <TableCell className="font-mono tabular-nums">{row.rawMinutes}</TableCell>
                  <TableCell>{row.reasons.join(", ")}</TableCell>
                </tr>
              ))}
            </TableBody>
          </Table>
        )}
      </section>
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
    </>
  );
}

function InvalidTermsList({ rows }: { rows: readonly { partner: string; label: string; message: string }[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className={HEADING}>{INVALID_CONTRACT_TERMS_LABEL}</h3>
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
      <h3 className={HEADING}>{label}</h3>
      {names.length === 0 ? (
        <p className="text-sm text-foreground">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {names.map((name) => (
            <li key={name} className="text-sm text-foreground">{name}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function IngestionList({ label, rows }: { label: string; rows: readonly IngestionRow[] }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className={HEADING}>{label}</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-foreground">None</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((row) => (
            <li key={row.pirKey} className="text-sm text-foreground">
              {row.href === null ? (
                <span className="font-mono">{row.pirKey}</span>
              ) : (
                <a href={row.href} target="_blank" rel="noopener noreferrer" className="font-mono text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring">{row.pirKey}</a>
              )}
              {row.detail ? <span className="text-muted-foreground"> · {row.detail}</span> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
