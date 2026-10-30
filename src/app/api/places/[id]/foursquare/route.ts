import { authenticatedUid, errorResponse, jsonResponse, smallJson } from "@/server/auth/request";
import { lookupSavedFsq } from "@/server/places/foursquare";
import { autofillFoursquare, limitWrites, removeFoursquare } from "@/server/places/service";
import { z } from "zod";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const uid = await authenticatedUid(request), { id } = await context.params;
    if (new URL(request.url).searchParams.get("mode") === "auto") return jsonResponse(await autofillFoursquare(uid, id));
    return jsonResponse(await lookupSavedFsq(uid, id));
  } catch (error) { return errorResponse(error); }
}
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const uid = await authenticatedUid(request), { id } = await context.params;
    const { expectedUpdatedAt } = z.object({ expectedUpdatedAt: z.number().int().nonnegative() }).strict().parse(await smallJson(request));
    await limitWrites(uid);
    return jsonResponse({ place: await removeFoursquare(uid, id, expectedUpdatedAt) });
  } catch (error) { return errorResponse(error); }
}
