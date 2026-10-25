import { authenticatedUid, errorResponse, jsonResponse, smallJson } from "@/server/auth/request";
import { collectionActionSchema } from "@/lib/places/schema";
import { changeCollection, getCollections, getMembership } from "@/server/places/collections";
import { limitWrites } from "@/server/places/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const uid = await authenticatedUid(request), place = new URL(request.url).searchParams.get("place");
    return jsonResponse(place ? await getMembership(uid, place) : { lists: await getCollections(uid) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const uid = await authenticatedUid(request), input = collectionActionSchema.parse(await smallJson(request));
    await limitWrites(uid);
    return jsonResponse(await changeCollection(uid, input));
  } catch (error) { return errorResponse(error); }
}
