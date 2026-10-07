import { unstable_noStore as noStore } from "next/cache";
import { loadDashboard } from "./dashboard/load";
import { TechnicalDashboard } from "./dashboard/technical-dashboard";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ window?: string | string[]; backtest?: string | string[] }>;
}) {
  noStore();
  const params = await searchParams;
  const requested = Array.isArray(params.window) ? undefined : params.window;
  const backtest = Array.isArray(params.backtest) ? params.backtest[0] : params.backtest;
  const model = await loadDashboard(requested, backtest);
  return (
    <main className="mx-auto flex w-full min-w-0 max-w-6xl flex-col p-6">
      <TechnicalDashboard model={model} />
    </main>
  );
}
