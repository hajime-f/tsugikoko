import { authenticatedUid, errorResponse, jsonResponse, smallJson } from "@/server/auth/request";
import { actionSchema, editPlaceSchema } from "@/lib/places/schema";
import { limitWrites, updatePlace } from "@/server/places/service";
import { dispatchExtraction } from "@/server/places/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const uid = await authenticatedUid(request), { id } = await context.params;
    const input = editPlaceSchema.or(actionSchema).parse(await smallJson(request));
    await limitWrites(uid);
    const place = await updatePlace(uid, id, input);
    if (place.extraction === "pending" && !place.deleted) await dispatchExtraction(uid, id).catch(() => console.error("place_dispatch_failed"));
    return jsonResponse({ place });
  } catch (error) { return errorResponse(error); }
}
