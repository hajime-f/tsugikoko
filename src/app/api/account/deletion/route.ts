import { z } from "zod";
import { errorResponse, jsonResponse, recentlyAuthenticatedUid, smallJson } from "@/server/auth/request";
import { requestAccountDeletion } from "@/server/accounts/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const schema = z.object({ confirmation: z.literal("delete-account") }).strict();

export async function POST(request: Request) {
  try {
    const uid = await recentlyAuthenticatedUid(request);
    schema.parse(await smallJson(request));
    return jsonResponse(await requestAccountDeletion(uid), 202);
  } catch (error) { return errorResponse(error); }
}
