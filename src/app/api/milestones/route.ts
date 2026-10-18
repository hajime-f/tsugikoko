import { authenticatedUid, errorResponse, jsonResponse, smallJson } from "@/server/auth/request";
import { milestoneSeenSchema } from "@/lib/milestones/schema";
import { limitWrites } from "@/server/places/service";
import { markMilestoneShown, milestoneStatus } from "@/server/milestones/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    return jsonResponse(await milestoneStatus(await authenticatedUid(request)));
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request) {
  try {
    const uid = await authenticatedUid(request), { threshold } = milestoneSeenSchema.parse(await smallJson(request));
    await limitWrites(uid);
    await markMilestoneShown(uid, threshold);
    return jsonResponse({ ok: true });
  } catch (error) { return errorResponse(error); }
}
