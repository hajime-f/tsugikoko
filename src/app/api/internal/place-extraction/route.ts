import { z } from "zod";
import { smallJson } from "@/server/auth/request";
import { verifyTaskRequest } from "@/server/places/dispatch";
import { processExtraction } from "@/server/places/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const taskSchema = z.object({ uid: z.string().min(1).max(128).regex(/^[^/]+$/), id: z.string().regex(/^[a-f0-9]{64}$/) }).strict();

// Cloud Tasksだけが呼び出す。2xx以外を返すとキューの設定に従って再試行される。
export async function POST(request: Request) {
  if (!await verifyTaskRequest(request)) return new Response(null, { status: 401 });
  let task: z.infer<typeof taskSchema>;
  try { task = taskSchema.parse(await smallJson(request)); }
  catch { return new Response(null, { status: 400 }); }
  try {
    const status = await processExtraction(task.uid, task.id);
    return new Response(null, { status: status === "busy" ? 503 : 204 });
  } catch {
    console.error("place_task_failed");
    return new Response(null, { status: 500 });
  }
}
