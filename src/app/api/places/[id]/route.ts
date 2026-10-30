import { authenticatedUid, errorResponse, jsonResponse, smallJson } from "@/server/auth/request";
import { actionSchema, editPlaceSchema, visitActionSchema, membershipSchema } from "@/lib/places/schema";
import { setMembership } from "@/server/places/collections";
import { limitWrites, listVisits, updatePlace, updateVisit } from "@/server/places/service";
import { dispatchExtraction } from "@/server/places/dispatch";
import { selectedFsq } from "@/server/places/foursquare";

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
    if (body?.action === "setLists") {
      const input = membershipSchema.parse(body);
      await limitWrites(uid);
      return jsonResponse(await setMembership(uid, id, input));
    }
    const isVisit = body && typeof body.action === "string" && ["addVisit", "editVisit", "deleteVisit"].includes(body.action);
    const input = isVisit ? visitActionSchema.parse(body) : editPlaceSchema.or(actionSchema).parse(body);
    await limitWrites(uid);
    const selection = "foursquare" in input ? input.foursquare : undefined;
    const origin = selection ? await selectedFsq(uid, id, selection) : undefined;
    const clean = "foursquare" in input ? (({ foursquare: _selection, ...rest }) => rest)(input) : input;
    const place = "visitId" in clean ? await updateVisit(uid, id, clean) : await updatePlace(uid, id, clean, origin);
    if (place.extraction === "pending" && !place.deleted) await dispatchExtraction(uid, id).catch(() => console.error("place_dispatch_failed"));
    return jsonResponse({ place });
  } catch (error) { return errorResponse(error); }
}
