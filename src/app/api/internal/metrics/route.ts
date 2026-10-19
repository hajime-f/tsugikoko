import { verifyServiceRequest } from "@/server/auth/request";
import { metricsConfig, recordDailyMetrics } from "@/server/metrics/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Cloud Schedulerだけが毎日呼び出す。失敗時は5xxを返し、Schedulerの再試行に任せる。
export async function POST(request: Request) {
  const config = metricsConfig();
  if (!config || !await verifyServiceRequest(request, config.url, config.invoker)) return new Response(null, { status: 401 });
  try {
    await recordDailyMetrics();
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("metrics_failed", error instanceof Error ? error.message : "unknown");
    return new Response(null, { status: 500 });
  }
}
