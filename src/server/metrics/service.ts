import "server-only";
import { adminApp, adminAuth, database } from "@/server/firebase/admin";
import { previousJapanDay, summarize, type DailyMetrics, type PlaceFacts, type UserFacts } from "@/lib/metrics/daily";

const MAX_SCANNED_RECORDS = 50_000;
const MAX_USERS = 50_000;
const columns = ["date", "generated_at", "truncated", "total_users", "new_users", "active_users_7d", "active_users_30d", "users_with_places", "saved_places", "new_saved_places", "visited_places", "total_visits"] as const;
const types: Record<(typeof columns)[number], string> = {
  date: "DATE", generated_at: "TIMESTAMP", truncated: "BOOL", total_users: "INT64", new_users: "INT64", active_users_7d: "INT64", active_users_30d: "INT64",
  users_with_places: "INT64", saved_places: "INT64", new_saved_places: "INT64", visited_places: "INT64", total_visits: "INT64",
};

export function metricsConfig() {
  const dataset = process.env.METRICS_DATASET, invoker = process.env.METRICS_INVOKER, url = process.env.METRICS_URL;
  if (process.env.METRICS_ENABLED !== "true" || !dataset || !invoker || !url || process.env.FIRESTORE_EMULATOR_HOST) return null;
  if (!/^[a-z][a-z0-9-]+\.[A-Za-z_][A-Za-z0-9_]*$/.test(dataset) || !url.startsWith("https://")) return null;
  return { dataset, invoker, url };
}

const time = (value: string | null | undefined) => { const parsed = value ? Date.parse(value) : NaN; return Number.isFinite(parsed) ? parsed : null; };

async function collectUsers() {
  const users: UserFacts[] = [];
  let pageToken: string | undefined;
  do {
    const page = await adminAuth().listUsers(1000, pageToken);
    for (const user of page.users) users.push({ createdAt: time(user.metadata.creationTime) ?? 0, lastActiveAt: time(user.metadata.lastRefreshTime) ?? time(user.metadata.lastSignInTime) });
    pageToken = page.pageToken;
  } while (pageToken && users.length < MAX_USERS);
  return { users, truncated: Boolean(pageToken) };
}

async function collectPlaces() {
  const snapshot = await database().collectionGroup("savedPlaces").select("deleted", "createdAt", "visitCount").limit(MAX_SCANNED_RECORDS).get();
  const places: PlaceFacts[] = [];
  for (const doc of snapshot.docs) {
    const owner = doc.ref.parent.parent?.id, data = doc.data();
    if (!owner) continue;
    places.push({ owner, deleted: data.deleted === true, createdAt: typeof data.createdAt === "number" ? data.createdAt : 0, visitCount: typeof data.visitCount === "number" ? data.visitCount : 0 });
  }
  return { places, truncated: snapshot.size >= MAX_SCANNED_RECORDS };
}

// 同じ日を再実行しても1行になるよう、日付をキーに置き換える。
async function writeRow(dataset: string, row: DailyMetrics) {
  const [project, name] = dataset.split(".");
  const token = (await adminApp().options.credential!.getAccessToken()).access_token;
  const query = `MERGE \`${project}.${name}.daily_metrics\` AS target USING (SELECT ${columns.map(column => `@${column} AS ${column}`).join(", ")}) AS source ON target.date = source.date
    WHEN MATCHED THEN UPDATE SET ${columns.filter(column => column !== "date").map(column => `${column} = source.${column}`).join(", ")}
    WHEN NOT MATCHED THEN INSERT (${columns.join(", ")}) VALUES (${columns.map(column => `source.${column}`).join(", ")})`;
  const response = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${project}/queries`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    signal: AbortSignal.timeout(30_000), redirect: "error", cache: "no-store",
    body: JSON.stringify({
      query, useLegacySql: false, location: "asia-northeast1", timeoutMs: 25_000, parameterMode: "NAMED",
      queryParameters: columns.map(column => ({ name: column, parameterType: { type: types[column] }, parameterValue: { value: String(row[column]) } })),
    }),
  });
  if (!response.ok) throw new Error(`BigQuery HTTP ${response.status}`);
  const result = await response.json() as { jobComplete?: boolean; errors?: unknown[] };
  if (!result.jobComplete || result.errors?.length) throw new Error("BigQuery job incomplete");
}

export async function recordDailyMetrics(now = Date.now()) {
  const config = metricsConfig();
  if (!config) throw new Error("metrics disabled");
  const [{ users, truncated: usersTruncated }, { places, truncated: placesTruncated }] = await Promise.all([collectUsers(), collectPlaces()]);
  const row = summarize(previousJapanDay(now), users, places, { now, truncated: usersTruncated || placesTruncated });
  await writeRow(config.dataset, row);
  console.info("metrics_recorded", row.date);
  return row;
}
