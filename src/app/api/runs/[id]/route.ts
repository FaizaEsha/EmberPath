import { cookies } from "next/headers";
import { readRun, publicRun } from "@/lib/store";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id))
    return Response.json({ error: "Invalid run ID." }, { status: 400 });
  const run = await readRun(id);
  const owner = (await cookies()).get("emberpath-session")?.value;
  if (!run || !owner || run.owner !== owner)
    return Response.json({ error: "Run not found." }, { status: 404 });
  return Response.json(publicRun(run));
}
