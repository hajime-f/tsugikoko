import { authenticatedUid, errorResponse, jsonResponse, smallJson } from "@/server/auth/request";
import { areaPreferenceSchema } from "@/lib/areas/schema";
import { limitWrites } from "@/server/places/service";
import { getArea, setArea } from "@/server/areas/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const uid = await authenticatedUid(request);
    return jsonResponse({ area: await getArea(uid) });
  } catch (error) { return errorResponse(error); }
}
export async function PATCH(request: Request) {
  try {
    const uid = await authenticatedUid(request), { area } = areaPreferenceSchema.parse(await smallJson(request));
    await limitWrites(uid);
    return jsonResponse({ area: await setArea(uid, area) });
  } catch (error) { return errorResponse(error); }
}
