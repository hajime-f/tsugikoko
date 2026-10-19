// 日次集計（BigQuery の analytics.daily_metrics の1行）。個人を特定できる値は含めない。
// 件数は集計時点の累計、new_* は対象日（日本時間）に作られた件数。
export type DailyMetrics = {
  date: string; generated_at: string; truncated: boolean;
  total_users: number; new_users: number; active_users_7d: number; active_users_30d: number; users_with_places: number;
  saved_places: number; new_saved_places: number; visited_places: number; total_visits: number;
};
export type UserFacts = { createdAt: number; lastActiveAt: number | null };
export type PlaceFacts = { owner: string; deleted: boolean; createdAt: number; visitCount: number };

const DAY_MS = 24 * 60 * 60 * 1000, JST_MS = 9 * 60 * 60 * 1000;

// 対象日は、実行時刻の前日（日本時間）。0時台に実行して前日分を確定させる。
export function previousJapanDay(now: number) {
  const start = Math.floor((now + JST_MS) / DAY_MS) * DAY_MS - DAY_MS - JST_MS;
  return { date: new Date(start + JST_MS).toISOString().slice(0, 10), start, end: start + DAY_MS };
}

export function summarize(day: ReturnType<typeof previousJapanDay>, users: UserFacts[], places: PlaceFacts[], options: { now: number; truncated: boolean }): DailyMetrics {
  const inDay = (time: number) => time >= day.start && time < day.end;
  // 最終利用時刻は上書きされるため、対象日の終わりから集計時点までの利用も含める。
  const activeWithin = (days: number) => users.filter(user => user.lastActiveAt !== null && user.lastActiveAt >= day.end - days * DAY_MS).length;
  const active = places.filter(place => !place.deleted);
  return {
    date: day.date, generated_at: new Date(options.now).toISOString(), truncated: options.truncated,
    total_users: users.filter(user => user.createdAt < day.end).length,
    new_users: users.filter(user => inDay(user.createdAt)).length,
    active_users_7d: activeWithin(7), active_users_30d: activeWithin(30),
    users_with_places: new Set(active.map(place => place.owner)).size,
    saved_places: active.length,
    new_saved_places: places.filter(place => inDay(place.createdAt)).length,
    visited_places: active.filter(place => place.visitCount > 0).length,
    total_visits: active.reduce((sum, place) => sum + place.visitCount, 0),
  };
}
