import { authenticatedUid, errorResponse, jsonResponse, smallJson } from "@/server/auth/request";
import { createPlaceSchema } from "@/lib/places/schema";
import { createPlace, limitWrites, listPlaces } from "@/server/places/service";
import { dispatchExtraction } from "@/server/places/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request) {
  try {
    const uid = await authenticatedUid(request), params = new URL(request.url).searchParams;
    const result = await listPlaces(uid, params.get("trash") === "1", params.get("cursor"));
    const pending = result.places.filter((place) => place.extraction === "pending" && !place.deleted).slice(0, 3);
    // 止まった取得の再登録。登録の失敗で一覧表示を止めない。
    await Promise.allSettled(pending.map((place) => dispatchExtraction(uid, place.id)));
    return jsonResponse(result);
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const uid = await authenticatedUid(request), { url } = createPlaceSchema.parse(await smallJson(request));
    await limitWrites(uid);
    const result = await createPlace(uid, url);
    if (result.place.extraction === "pending") await dispatchExtraction(uid, result.place.id).catch(() => console.error("place_dispatch_failed"));
    return jsonResponse(result, result.duplicate ? 200 : 201);
  } catch (error) { return errorResponse(error); }
}
