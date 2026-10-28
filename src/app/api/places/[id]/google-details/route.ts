import { authenticatedUid, errorResponse, jsonResponse } from "@/server/auth/request";
import { readGooglePlace } from "@/server/places/google-maps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const uid = await authenticatedUid(request), { id } = await context.params;
    return jsonResponse(await readGooglePlace(uid, id));
  } catch (error) { return errorResponse(error); }
}
