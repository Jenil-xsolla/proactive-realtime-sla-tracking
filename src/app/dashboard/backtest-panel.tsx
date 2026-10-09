import { Table, TableBody, TableCell, TableHead, TableHeaderCell } from "@/ui";
import type { BacktestPanel as BacktestPanelModel } from "./model";

export function BacktestPanel({
  partnerName,
  panel,
}: {
  partnerName: string;
  panel: BacktestPanelModel;
}) {
  return (
    <div className="border-t border-border p-3">
      <h4 className="text-sm font-medium text-foreground">Historical replay for {partnerName}</h4>
      {panel.state === "error" ? (
        <p className="mt-3 text-sm text-danger" role="alert">
          {panel.message}
        </p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">{panel.rangeLabel}</p>
          <div className="min-w-0 overflow-x-auto">
            <Table caption={`Historical replay for ${partnerName}`}>
              <TableHead>
                <tr className="border-b border-border">
                  <TableHeaderCell>Month</TableHeaderCell>
                  <TableHeaderCell>Scope</TableHeaderCell>
                  <TableHeaderCell numeric>Steps</TableHeaderCell>
                  <TableHeaderCell numeric>Breached</TableHeaderCell>
                  <TableHeaderCell numeric>Trend</TableHeaderCell>
                  <TableHeaderCell numeric>Level</TableHeaderCell>
                  <TableHeaderCell numeric>Meeting</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {panel.rows.map((row) =>
                  row.kind === "none" ? (
                    <tr key={row.key} className="border-b border-border last:border-b-0">
                      <TableCell>{row.month}</TableCell>
                      <TableCell className="text-muted-foreground">{row.label}</TableCell>
                      <TableCell>{""}</TableCell>
                      <TableCell>{""}</TableCell>
                      <TableCell>{""}</TableCell>
                      <TableCell>{""}</TableCell>
                      <TableCell>{""}</TableCell>
                    </tr>
                  ) : (
                    <tr key={row.key} className="border-b border-border last:border-b-0">
                      <TableCell>{row.month}</TableCell>
                      <TableCell>{row.scope}</TableCell>
                      <TableCell numeric>{row.steps}</TableCell>
                      <TableCell numeric>{row.breaching}</TableCell>
                      <TableCell numeric>{row.trend}</TableCell>
                      <TableCell numeric>{row.level}</TableCell>
                      <TableCell numeric>{row.meeting}</TableCell>
                    </tr>
                  ),
                )}
              </TableBody>
            </Table>
          </div>
          <p className="text-sm text-muted-foreground">{panel.note}</p>
        </div>
      )}
    </div>
  );
}
