import { authenticatedUid, errorResponse, jsonResponse, smallJson } from "@/server/auth/request";
import { recommendationActionSchema } from "@/lib/recommendations/schema";
import { limitWrites, saveCommonPlace } from "@/server/places/service";
import { listDismissed, listRecommendations, recommendedPlace, setDismissed } from "@/server/recommendations/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const uid = await authenticatedUid(request), params = new URL(request.url).searchParams;
    const cursor = params.get("cursor");
    return jsonResponse(params.get("dismissed") === "1" ? await listDismissed(uid, cursor) : await listRecommendations(uid, cursor));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const uid = await authenticatedUid(request), { action, id } = recommendationActionSchema.parse(await smallJson(request));
    await limitWrites(uid);
    if (action === "save") return jsonResponse(await saveCommonPlace(uid, await recommendedPlace(id)));
    await setDismissed(uid, id, action === "dismiss");
    return jsonResponse({ ok: true });
  } catch (error) { return errorResponse(error); }
}
