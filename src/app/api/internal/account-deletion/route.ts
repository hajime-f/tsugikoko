import { z } from "zod";
import { smallJson } from "@/server/auth/request";
import { processAccountDeletion, verifyAccountDeletionTask } from "@/server/accounts/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const schema = z.object({ uid: z.string().regex(/^[A-Za-z0-9:_-]{1,128}$/), requestId: z.string().uuid() }).strict();

export async function POST(request: Request) {
  if (!await verifyAccountDeletionTask(request)) return new Response(null, { status: 401 });
  let task: z.infer<typeof schema>;
  try { task = schema.parse(await smallJson(request)); }
  catch { return new Response(null, { status: 400 }); }
  try {
    const status = await processAccountDeletion(task.uid, task.requestId);
    return new Response(null, { status: status === "waiting" ? 503 : 204 });
  } catch {
    console.error("account_deletion_task_failed");
    return new Response(null, { status: 503 });
  }
}
