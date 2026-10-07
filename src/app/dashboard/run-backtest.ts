import { getDatabase, loadOutages, readContractTerms } from "@/data";
import { DbTermsProvider } from "@/terms";
import { backtest, scopesSeenInReplay, type BacktestReport } from "../../../scripts/backtest";

/** One partner's historical replay. The button calls this once terms are bound. */
export async function runPartnerBacktest(partner: string, through: Date): Promise<BacktestReport> {
  const database = getDatabase();
  const partition = await loadOutages(database);
  const terms = new DbTermsProvider(() => readContractTerms(database));
  const scopes = await scopesSeenInReplay(terms, through, partner);
  return backtest({
    outages: partition.usable,
    scopes,
    partner,
    through,
  });
}
