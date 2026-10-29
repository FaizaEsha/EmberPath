// Run with both local servers running: npm run test:integration
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { starterWorkflow, type PublicRun, type Run } from "../src/lib/workflow";
import { readRun, writeRun } from "../src/lib/store";

const base = process.env.TEST_BASE_URL || "http://127.0.0.1:3000";
let cookie = "";
async function request(path: string, body?: unknown, authenticated = true) {
  const response = await fetch(`${base}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
      Origin: base,
      ...(authenticated && cookie ? { Cookie: cookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (response.headers.get("set-cookie"))
    cookie = response.headers.get("set-cookie")!.split(";")[0];
  return { status: response.status, data: await response.json() };
}
async function wait(id: string): Promise<PublicRun> {
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const { data } = await request(`/api/runs/${id}`);
    if (data.status === "completed") return data;
    if (data.status === "failed") throw new Error(data.error);
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("Run timed out. Ensure the Inngest dev server is connected.");
}
async function main() {
  const workflow = structuredClone(starterWorkflow);
  const payload = {
    workflow,
    input: "A sample customer message",
    mode: "demo",
  };
  const started = await request("/api/runs", payload);
  assert.equal(started.status, 202, JSON.stringify(started.data));
  const yes = await wait(started.data.id);
  assert.deepEqual(
    yes.logs.map((l) => [l.nodeId, l.answer]),
    [
      ["request", "YES"],
      ["delivery", "YES"],
      ["priority", "YES"],
    ],
  );
  console.log("PASS: real Inngest execution follows YES branches in order");
  assert.equal(
    (await request(`/api/runs/${yes.id}`, undefined, false)).status,
    404,
  );
  assert.equal("owner" in yes, false);
  console.log(
    "PASS: execution data is isolated to the originating browser session",
  );
  workflow.nodes[0].data.demoAnswer = "NO";
  const no = await request("/api/runs", { ...payload, workflow });
  assert.equal(no.status, 202, JSON.stringify(no.data));
  const result = await wait(no.data.id);
  assert.deepEqual(
    result.logs.map((l) => l.nodeId),
    ["request", "sales"],
  );
  console.log("PASS: NO branches skip unrelated nodes and terminate correctly");
  const invalid = structuredClone(workflow);
  invalid.edges.push({
    id: "cycle",
    source: "sales",
    target: "request",
    sourceHandle: "YES",
  });
  assert.equal(
    (await request("/api/runs", { ...payload, workflow: invalid })).status,
    400,
  );
  assert.equal(
    (await request("/api/runs", { ...payload, input: "" })).status,
    400,
  );
  console.log("PASS: invalid graphs and empty inputs are rejected by the API");
  const crossOrigin = await fetch(`${base}/api/runs`, {
    method: "POST",
    headers: {
      Origin: "https://unrelated.example",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  assert.equal(crossOrigin.status, 403);
  console.log(
    "PASS: same-origin runs work and cross-origin submissions are rejected",
  );
  const history = await request("/api/runs");
  assert.ok(history.data.some((r: PublicRun) => r.id === yes.id));
  console.log("PASS: completed runs are recorded in execution history");

  // A disposable failed-run fixture exercises retry without making paid AI calls.
  const original = await readRun(yes.id);
  assert.ok(original);
  const fixture: Run = {
    ...original,
    id: randomUUID(),
    status: "failed",
    logs: [
      original.logs[0],
      {
        ...original.logs[1],
        status: "error",
        answer: undefined,
        error: "Simulated transient failure",
      },
    ],
  };
  await writeRun(fixture);
  const retried = await request("/api/runs", {
    ...payload,
    retryOf: fixture.id,
  });
  assert.equal(retried.status, 202, JSON.stringify(retried.data));
  const resumed = await wait(retried.data.id);
  assert.equal(resumed.startNodeId, "delivery");
  assert.deepEqual(
    resumed.logs.map((l) => l.nodeId),
    ["request", "delivery", "priority"],
  );
  assert.equal(resumed.logs[0].startedAt, original.logs[0].startedAt);
  console.log(
    "PASS: retry resumes at the failed node and retains successful decisions",
  );
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
