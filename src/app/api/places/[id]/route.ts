import { authenticatedUid, errorResponse, jsonResponse, smallJson } from "@/server/auth/request";
import { actionSchema, editPlaceSchema, visitActionSchema } from "@/lib/places/schema";
import { limitWrites, listVisits, updatePlace, updateVisit } from "@/server/places/service";
import { dispatchExtraction } from "@/server/places/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const uid = await authenticatedUid(request), { id } = await context.params;
    return jsonResponse(await listVisits(uid, id, new URL(request.url).searchParams.get("cursor")));
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const uid = await authenticatedUid(request), { id } = await context.params;
    const body = await smallJson(request);
    const isVisit = body && typeof body.action === "string" && ["addVisit", "editVisit", "deleteVisit"].includes(body.action);
    const input = isVisit ? visitActionSchema.parse(body) : editPlaceSchema.or(actionSchema).parse(body);
    await limitWrites(uid);
    const place = "visitId" in input ? await updateVisit(uid, id, input) : await updatePlace(uid, id, input);
    if (place.extraction === "pending" && !place.deleted) await dispatchExtraction(uid, id).catch(() => console.error("place_dispatch_failed"));
    return jsonResponse({ place });
  } catch (error) { return errorResponse(error); }
}
