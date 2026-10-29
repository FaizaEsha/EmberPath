import test from "node:test";
import assert from "node:assert/strict";
import {
  nextNode,
  parseAnswer,
  starterWorkflow,
  validateWorkflow,
} from "../src/lib/workflow";
const graph = () => structuredClone(starterWorkflow);

test("YES and NO select different branches", () => {
  assert.equal(nextNode(graph(), "request", "YES"), "delivery");
  assert.equal(nextNode(graph(), "request", "NO"), "sales");
});
test("a missing outgoing branch terminates the path", () => {
  assert.equal(nextNode(graph(), "delivery", "NO"), undefined);
  assert.equal(nextNode(graph(), "priority", "YES"), undefined);
});
test("only exact binary model responses are accepted", () => {
  assert.equal(parseAnswer(" YES\n"), "YES");
  assert.equal(parseAnswer("NO"), "NO");
  for (const value of ["yes", "YES because…", "NO.", "", null, undefined])
    assert.throws(() => parseAnswer(value));
});
test("cycles and self-connections cannot run indefinitely", () => {
  const cycle = graph();
  cycle.edges.push({
    id: "cycle",
    source: "priority",
    target: "request",
    sourceHandle: "YES",
  });
  assert.throws(() => validateWorkflow(cycle), /Loops/);
  const self = graph();
  self.edges.push({
    id: "self",
    source: "priority",
    target: "priority",
    sourceHandle: "NO",
  });
  assert.throws(() => validateWorkflow(self), /Loops/);
});
test("ambiguous duplicate branches are rejected", () => {
  const w = graph();
  w.edges.push({
    id: "duplicate",
    source: "request",
    target: "priority",
    sourceHandle: "YES",
  });
  assert.throws(() => validateWorkflow(w), /only one connection/);
});
test("dangling connections and missing entry points are rejected", () => {
  const w = graph();
  w.edges[0].target = "missing";
  assert.throws(() => validateWorkflow(w), /missing node/);
  assert.throws(
    () => validateWorkflow({ ...graph(), startNodeId: "missing" }),
    /entry node/,
  );
});
test("duplicate IDs and malformed imports are rejected", () => {
  const w = graph();
  w.nodes.push(w.nodes[0]);
  assert.throws(() => validateWorkflow(w), /unique ID/);
  assert.throws(() => validateWorkflow({ nodes: [] }));
  assert.throws(() => validateWorkflow({ ...graph(), name: "  " }));
});
test("limits constrain large prompts and oversized graphs", () => {
  const w = graph();
  w.nodes[0].data.prompt = "x".repeat(2001);
  assert.throws(() => validateWorkflow(w));
  assert.throws(() =>
    validateWorkflow({ ...graph(), nodes: Array(41).fill(graph().nodes[0]) }),
  );
});
test("unconnected decision nodes and converging paths are valid", () => {
  const w = graph();
  w.edges.push({
    id: "merge",
    source: "sales",
    target: "priority",
    sourceHandle: "YES",
  });
  assert.equal(validateWorkflow(w).nodes.length, 4);
});
test("exports preserve positions, prompts, and demo answers", () => {
  const w = graph();
  w.nodes[0].data.demoAnswer = "NO";
  assert.deepEqual(validateWorkflow(JSON.parse(JSON.stringify(w))), w);
});
