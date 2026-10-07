import type { ReactNode } from "react";
import { reconciliationText } from "./copy";
import type { OutageView } from "./model";

export function OutageLines({
  outages,
  serviceCaption = "Service",
}: {
  outages: readonly OutageView[];
  serviceCaption?: string;
}) {
  const groups = groupOutages(outages);
  return (
    <div className="flex flex-col gap-3">
      {groups.map((group) => {
        const merged = group.outages.length > 1;
        return (
          <div key={group.id} className="rounded border border-border bg-background">
            <ul className="flex flex-col">
              {group.outages.map((outage) => (
                <li
                  key={`${outage.mergeGroup}:${outage.pirKey}:${outage.started}`}
                  className="border-b border-border p-3 last:border-b-0"
                >
                  <OutageRecord outage={outage} serviceCaption={serviceCaption} />
                </li>
              ))}
            </ul>
            {merged ? (
              <p className="border-t border-border px-3 py-3 text-xs text-muted-foreground">
                Overlapping minutes were counted once.
              </p>
            ) : null}
          </div>
        );
      })}
      <p className="text-sm text-muted-foreground">{reconciliationText(outages)}</p>
    </div>
  );
}

function OutageRecord({ outage, serviceCaption }: { outage: OutageView; serviceCaption: string }) {
  return (
    <article className="flex flex-col gap-3">
      <PirKey outage={outage} />
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        <Field label="Started" mono>
          {outage.started}
        </Field>
        <Field label="Ended" mono>
          <span className="block">{outage.ended}</span>
          <span className="mt-1 block font-sans text-xs font-normal normal-case tracking-normal text-muted-foreground">
            computed
          </span>
        </Field>
        <Field label="Minutes" mono>
          {outage.minutesLabel}
        </Field>
        <Field label={serviceCaption}>{outage.service}</Field>
        <Field label="Severity">{outage.severity}</Field>
        {outage.merchantId !== null ? (
          <Field label="Merchant id" mono>
            {outage.merchantId}
          </Field>
        ) : null}
        {outage.source !== null ? <Field label="Source" mono>{outage.source}</Field> : null}
        {outage.review !== null ? (
          <Field label="Review" mono wide>
            {outage.review}
          </Field>
        ) : null}
      </dl>
    </article>
  );
}

function Field({
  label,
  children,
  mono = false,
  wide = false,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <div className={`flex min-w-0 flex-col gap-1 ${wide ? "col-span-2" : ""}`}>
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`text-sm text-foreground ${mono ? "font-mono tabular-nums" : ""}`}>{children}</dd>
    </div>
  );
}

function PirKey({ outage }: { outage: OutageView }) {
  if (outage.href === null) {
    return (
      <p className="font-mono text-sm font-medium">
        {outage.pirKey} <span className="font-normal text-muted-foreground">no ticket link</span>
      </p>
    );
  }
  return (
    <p className="text-sm font-medium">
      <a
        href={outage.href}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono text-primary underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
      >
        {outage.pirKey}
      </a>
    </p>
  );
}

function groupOutages(outages: readonly OutageView[]): { id: string; outages: OutageView[] }[] {
  const order: string[] = [];
  const groups = new Map<string, OutageView[]>();
  for (const outage of outages) {
    const existing = groups.get(outage.mergeGroup);
    if (existing === undefined) {
      order.push(outage.mergeGroup);
      groups.set(outage.mergeGroup, [outage]);
    } else {
      existing.push(outage);
    }
  }
  return order.map((id) => ({ id, outages: groups.get(id) ?? [] }));
}
