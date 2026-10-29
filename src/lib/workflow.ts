import { z } from "zod";

export const answerSchema = z.enum(["YES", "NO"]);
export type Answer = z.infer<typeof answerSchema>;
const id = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9_-]+$/);
export const workflowSchema = z.object({
  name: z.string().trim().min(1).max(80),
  startNodeId: id,
  nodes: z
    .array(
      z.object({
        id,
        type: z.literal("decision").default("decision"),
        position: z.object({ x: z.number().finite(), y: z.number().finite() }),
        data: z.object({
          label: z.string().trim().min(1).max(80),
          prompt: z.string().trim().min(1).max(2000),
          demoAnswer: answerSchema.default("YES"),
        }),
      }),
    )
    .min(1)
    .max(40),
  edges: z
    .array(
      z.object({
        id,
        source: id,
        target: id,
        sourceHandle: answerSchema,
        targetHandle: z.string().nullish(),
      }),
    )
    .max(80),
});
export type Workflow = z.infer<typeof workflowSchema>;
export type DecisionNode = Workflow["nodes"][number];
export type RunLog = {
  nodeId: string;
  label: string;
  status: "running" | "completed" | "error";
  answer?: Answer;
  error?: string;
  startedAt: string;
  duration?: number;
};
export type Run = {
  id: string;
  owner: string;
  workflow: Workflow;
  input: string;
  mode: "demo" | "live";
  status: "queued" | "running" | "completed" | "failed";
  logs: RunLog[];
  createdAt: string;
  finishedAt?: string;
  error?: string;
  retryOf?: string;
  startNodeId: string;
};
export type PublicRun = Omit<Run, "owner">;

export function validateWorkflow(value: unknown): Workflow {
  const graph = workflowSchema.parse(value);
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length)
    throw new Error("Each node needs a unique ID.");
  if (!ids.has(graph.startNodeId))
    throw new Error("Choose an existing entry node.");
  if (new Set(graph.edges.map((e) => e.id)).size !== graph.edges.length)
    throw new Error("Each connection needs a unique ID.");
  const branches = new Set<string>();
  for (const edge of graph.edges) {
    if (!ids.has(edge.source) || !ids.has(edge.target))
      throw new Error("A connection points to a missing node.");
    const key = `${edge.source}:${edge.sourceHandle}`;
    if (branches.has(key))
      throw new Error("Each YES or NO output can have only one connection.");
    branches.add(key);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  function visit(nodeId: string) {
    if (visiting.has(nodeId))
      throw new Error(
        "Loops are not supported. Connect nodes in one direction.",
      );
    if (visited.has(nodeId)) return;
    visiting.add(nodeId);
    graph.edges
      .filter((e) => e.source === nodeId)
      .forEach((e) => visit(e.target));
    visiting.delete(nodeId);
    visited.add(nodeId);
  }
  graph.nodes.forEach((n) => visit(n.id));
  return graph;
}
export function nextNode(workflow: Workflow, nodeId: string, answer: Answer) {
  return workflow.edges.find(
    (e) => e.source === nodeId && e.sourceHandle === answer,
  )?.target;
}
export function parseAnswer(raw: string | null | undefined): Answer {
  const result = answerSchema.safeParse(raw?.trim());
  if (!result.success)
    throw new Error(
      "The model did not return YES or NO. This step will be retried.",
    );
  return result.data;
}
export const starterWorkflow: Workflow = {
  name: "Customer request triage",
  startNodeId: "request",
  nodes: [
    {
      id: "request",
      type: "decision",
      position: { x: 60, y: 190 },
      data: {
        label: "Support request?",
        prompt:
          "Is this message asking for customer support with an existing order, account, or product?",
        demoAnswer: "YES",
      },
    },
    {
      id: "delivery",
      type: "decision",
      position: { x: 420, y: 65 },
      data: {
        label: "Delivery issue?",
        prompt:
          "Is the customer reporting a missing, late, or undelivered order?",
        demoAnswer: "YES",
      },
    },
    {
      id: "sales",
      type: "decision",
      position: { x: 420, y: 370 },
      data: {
        label: "Sales enquiry?",
        prompt:
          "Is the customer interested in buying a product or asking about pricing?",
        demoAnswer: "YES",
      },
    },
    {
      id: "priority",
      type: "decision",
      position: { x: 780, y: 65 },
      data: {
        label: "Needs priority care?",
        prompt:
          "Does the message describe an overdue delivery or an urgent problem that requires priority attention?",
        demoAnswer: "YES",
      },
    },
  ],
  edges: [
    {
      id: "request-yes",
      source: "request",
      target: "delivery",
      sourceHandle: "YES",
    },
    {
      id: "request-no",
      source: "request",
      target: "sales",
      sourceHandle: "NO",
    },
    {
      id: "delivery-yes",
      source: "delivery",
      target: "priority",
      sourceHandle: "YES",
    },
  ],
};
