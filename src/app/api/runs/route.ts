import { cookies } from "next/headers";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import { validateWorkflow, type Run } from "@/lib/workflow";
import { listRuns, readRun, writeRun, publicRun } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET() {
  const owner = (await cookies()).get("emberpath-session")?.value;
  return Response.json(owner ? await listRuns(owner) : []);
}
export async function POST(request: Request) {
  try {
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== request.headers.get("host"))
      return Response.json(
        { error: "Invalid request origin." },
        { status: 403 },
      );
    const raw = await request.text();
    if (raw.length > 150000)
      return Response.json(
        { error: "Workflow is too large." },
        { status: 413 },
      );
    const body = z
      .object({
        workflow: z.unknown(),
        input: z.string().trim().min(1).max(12000),
        mode: z.enum(["demo", "live"]),
        retryOf: z.string().uuid().optional(),
      })
      .parse(JSON.parse(raw));
    const jar = await cookies();
    const owner = jar.get("emberpath-session")?.value || randomUUID();
    jar.set("emberpath-session", owner, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    if (
      (await listRuns(owner)).some(
        (r) => r.status === "running" || r.status === "queued",
      )
    )
      return Response.json(
        {
          error:
            "A run is already in progress. Let it finish before starting another.",
        },
        { status: 409 },
      );
    let workflow = validateWorkflow(body.workflow);
    let input = body.input;
    let mode = body.mode;
    let startNodeId = workflow.startNodeId;
    let logs: Run["logs"] = [];
    if (body.retryOf) {
      const previous = await readRun(body.retryOf);
      if (!previous || previous.owner !== owner || previous.status !== "failed")
        throw new Error("Choose a failed run from your history to retry.");
      workflow = previous.workflow;
      input = previous.input;
      mode = previous.mode;
      startNodeId =
        previous.logs.find((l) => l.status === "error")?.nodeId ||
        previous.startNodeId;
      logs = previous.logs.filter((l) => l.status === "completed");
    }
    if (mode === "live" && !process.env.OPENAI_API_KEY)
      return Response.json(
        {
          error:
            "Add OPENAI_API_KEY to .env.local, restart the app, then choose Live AI. You can use Demo without a key.",
        },
        { status: 400 },
      );
    const run: Run = {
      id: randomUUID(),
      owner,
      workflow,
      input,
      mode,
      startNodeId,
      logs,
      status: "queued",
      createdAt: new Date().toISOString(),
      retryOf: body.retryOf,
    };
    await writeRun(run);
    try {
      await inngest.send({
        name: "emberpath/workflow.requested",
        data: { runId: run.id },
      });
    } catch {
      run.status = "failed";
      run.error =
        "Cannot reach Inngest. Start npm run inngest in a second terminal, then retry.";
      await writeRun(run);
      return Response.json({ error: run.error }, { status: 503 });
    }
    return Response.json(publicRun(run), { status: 202 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof z.ZodError
            ? error.issues[0].message
            : error instanceof Error
              ? error.message
              : "Unable to start workflow.",
      },
      { status: 400 },
    );
  }
}
