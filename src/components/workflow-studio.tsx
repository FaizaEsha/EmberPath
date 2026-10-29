"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  Handle,
  Position,
  MarkerType,
  applyNodeChanges,
  applyEdgeChanges,
  useReactFlow,
  type Node,
  type NodeProps,
  type Connection,
  type Edge,
  type NodeChange,
  type EdgeChange,
} from "@xyflow/react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUpFromLine,
  BookOpen,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  ExternalLink,
  FolderOpen,
  GitBranch,
  History,
  Loader2,
  MoreHorizontal,
  MousePointer2,
  Play,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Sparkles,
  Terminal,
  Trash2,
  Workflow as WorkflowIcon,
  X,
  Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  starterWorkflow,
  validateWorkflow,
  type Answer,
  type PublicRun,
  type Workflow,
} from "@/lib/workflow";
import "@xyflow/react/dist/style.css";

type NodeData = Workflow["nodes"][number]["data"] & {
  entry?: boolean;
  state?: string;
  answer?: string;
  order?: number;
};
type FlowNode = Node<NodeData, "decision">;
type SavedWorkflow = { id: string; savedAt: string; workflow: Workflow };
const DRAFT = "emberpath:draft:v1";
const LIBRARY = "emberpath:library:v1";
const emptyPrompt = "Does the input meet this condition?";

function DecisionCard({ data, selected }: NodeProps<FlowNode>) {
  return (
    <div
      className={`decision-card ${selected ? "is-selected" : ""} ${data.state || ""}`}
    >
      <Handle type="target" position={Position.Left} id="input" />
      <div className="node-top">
        <span className="node-symbol">
          <GitBranch size={16} />
        </span>
        <span>AI DECISION</span>
        <span className="node-index">
          {data.order ? (
            String(data.order).padStart(2, "0")
          ) : (
            <MoreHorizontal size={16} />
          )}
        </span>
      </div>
      <h3>{data.label}</h3>
      <p>{data.prompt}</p>
      <div className="node-footer">
        <span>
          {data.entry ? (
            <>
              <Zap size={11} /> ENTRY POINT
            </>
          ) : data.state === "completed" ? (
            <>
              <Check size={12} /> COMPLETED
            </>
          ) : data.state === "running" ? (
            <>
              <Loader2 size={12} className="spin" /> THINKING
            </>
          ) : data.state === "error" ? (
            "STEP FAILED"
          ) : (
            "BINARY RESPONSE"
          )}
        </span>
        {data.answer && <strong>{data.answer}</strong>}
      </div>
      <span className="port-label yes">YES</span>
      <Handle
        type="source"
        position={Position.Right}
        id="YES"
        style={{ top: "39%" }}
        className="port-yes"
      />
      <span className="port-label no">NO</span>
      <Handle
        type="source"
        position={Position.Right}
        id="NO"
        style={{ top: "76%" }}
        className="port-no"
      />
    </div>
  );
}
const nodeTypes = { decision: DecisionCard };
function cloneStarter() {
  return structuredClone(starterWorkflow);
}
async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const data = await response.json();
  if (!response.ok)
    throw new Error(data.error || "Something went wrong. Please try again.");
  return data;
}
export function WorkflowStudio() {
  return (
    <ReactFlowProvider>
      <Studio />
    </ReactFlowProvider>
  );
}

function Studio() {
  const [workflow, setWorkflow] = useState<Workflow>(cloneStarter);
  const [dimensions, setDimensions] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const [selected, setSelected] = useState<string | null>("request");
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [tab, setTab] = useState<"editor" | "history">("editor");
  const [panel, setPanel] = useState<"inspector" | "runner">("inspector");
  const [modal, setModal] = useState<"library" | "guide" | "new" | null>(null);
  const [library, setLibrary] = useState<SavedWorkflow[]>([]);
  const [input, setInput] = useState(
    "I paid for my order a week ago, but it still hasn't arrived. Could someone help me track it down?",
  );
  const [mode, setMode] = useState<"demo" | "live">("demo");
  const [run, setRun] = useState<PublicRun | null>(null);
  const [history, setHistory] = useState<PublicRun[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState<{
    text: string;
    error?: boolean;
  } | null>(null);
  const [storageError, setStorageError] = useState(false);
  const [logsOpen, setLogsOpen] = useState(true);
  const fileInput = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const { fitView, screenToFlowPosition } = useReactFlow();
  const busy =
    submitting || run?.status === "queued" || run?.status === "running";
  const node = workflow.nodes.find((n) => n.id === selected);
  const edge = workflow.edges.find((e) => e.id === selectedEdge);
  const flash = useCallback(
    (text: string, error = false) => setNotice({ text, error }),
    [],
  );
  const refreshHistory = useCallback(async () => {
    try {
      const runs = await api<PublicRun[]>("/api/runs");
      setHistory(runs);
      return runs;
    } catch {
      return [];
    }
  }, []);
  useEffect(() => {
    if (!ready || tab !== "editor" || !canvasRef.current) return;
    let timer: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => fitView({ padding: 0.16, duration: 250 }), 150);
    });
    observer.observe(canvasRef.current);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [ready, tab, fitView]);

  useEffect(() => {
    try {
      const draft = localStorage.getItem(DRAFT);
      if (draft) {
        const graph = validateWorkflow(JSON.parse(draft));
        setWorkflow(graph);
        setSelected(graph.startNodeId);
      }
      const saved = JSON.parse(localStorage.getItem(LIBRARY) || "[]");
      if (Array.isArray(saved))
        setLibrary(
          saved.map((s) => ({ ...s, workflow: validateWorkflow(s.workflow) })),
        );
    } catch {
      flash(
        "A saved workflow could not be loaded. The starter is ready to use.",
        true,
      );
    }
    setReady(true);
    refreshHistory().then((runs) => {
      const active = runs.find(
        (r) => r.status === "queued" || r.status === "running",
      );
      if (active) {
        setRun(active);
        setPanel("runner");
      }
    });
  }, [flash, refreshHistory]);
  useEffect(() => {
    if (!ready) return;
    const timeout = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT, JSON.stringify(workflow));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    }, 500);
    return () => clearTimeout(timeout);
  }, [workflow, ready]);
  useEffect(() => {
    if (notice) {
      const timeout = setTimeout(() => setNotice(null), 6500);
      return () => clearTimeout(timeout);
    }
  }, [notice]);
  useEffect(() => {
    if (!run || !["queued", "running"].includes(run.status)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const result = await api<PublicRun>(`/api/runs/${run!.id}`);
        if (cancelled) return;
        setRun(result);
        if (["completed", "failed"].includes(result.status)) {
          refreshHistory();
          return;
        }
      } catch {
        if (!cancelled)
          flash("Connection interrupted. Reconnecting to your run…", true);
      }
      if (!cancelled) timer = setTimeout(poll, 900);
    }
    timer = setTimeout(poll, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [run?.id, run?.status, flash, refreshHistory]); // eslint-disable-line react-hooks/exhaustive-deps

  function replaceWorkflow(graph: Workflow) {
    setWorkflow(graph);
    setSelected(graph.startNodeId);
    setSelectedEdge(null);
    setRun(null);
    setTab("editor");
    setModal(null);
    setPanel("inspector");
    setTimeout(() => fitView({ padding: 0.18, duration: 600 }), 80);
  }
  function addNode() {
    if (busy) return;
    if (workflow.nodes.length >= 40)
      return flash("A workflow can contain up to 40 nodes.", true);
    const position = screenToFlowPosition({
      x: Math.max(370, window.innerWidth / 2),
      y: window.innerHeight / 2,
    });
    const id = `node-${crypto.randomUUID().slice(0, 8)}`;
    setWorkflow((w) => ({
      ...w,
      nodes: [
        ...w.nodes,
        {
          id,
          type: "decision",
          position,
          data: {
            label: "New decision",
            prompt: emptyPrompt,
            demoAnswer: "YES",
          },
        },
      ],
    }));
    setRun(null);
    setSelected(id);
    setSelectedEdge(null);
    setPanel("inspector");
  }
  function updateNode(data: Partial<NodeData>) {
    setRun(null);
    setWorkflow((w) => ({
      ...w,
      nodes: w.nodes.map((n) =>
        n.id === selected ? { ...n, data: { ...n.data, ...data } } : n,
      ),
    }));
  }
  function deleteNode() {
    if (!node) return;
    if (workflow.nodes.length === 1)
      return flash("Keep at least one decision in your workflow.", true);
    if (node.id === workflow.startNodeId)
      return flash(
        "Set another node as the entry point before deleting this one.",
        true,
      );
    setWorkflow((w) => ({
      ...w,
      nodes: w.nodes.filter((n) => n.id !== selected),
      edges: w.edges.filter(
        (e) => e.source !== selected && e.target !== selected,
      ),
    }));
    setSelected(null);
    setRun(null);
  }
  function connect(connection: Connection) {
    if (busy) return;
    try {
      const newEdge = {
        ...connection,
        id: `edge-${crypto.randomUUID().slice(0, 8)}`,
        sourceHandle: connection.sourceHandle as Answer,
      };
      const graph = validateWorkflow({
        ...workflow,
        edges: [
          ...workflow.edges.filter(
            (e) =>
              !(
                e.source === connection.source &&
                e.sourceHandle === connection.sourceHandle
              ),
          ),
          newEdge,
        ],
      });
      setWorkflow(graph);
      setRun(null);
    } catch (error) {
      flash((error as Error).message, true);
    }
  }
  function onNodesChange(changes: NodeChange<FlowNode>[]) {
    const sizes = changes.filter((c) => c.type === "dimensions");
    if (sizes.length)
      setDimensions((previous) => {
        const next = { ...previous };
        for (const change of sizes)
          if (change.dimensions) next[change.id] = change.dimensions;
        return next;
      });
    if (busy || run) return;
    const safe = changes.filter((c) => c.type === "position");
    if (!safe.length) return;
    setWorkflow((w) => ({
      ...w,
      nodes: applyNodeChanges(safe, w.nodes as FlowNode[]).map((n) => ({
        id: n.id,
        type: "decision",
        position: n.position,
        data: {
          label: n.data.label,
          prompt: n.data.prompt,
          demoAnswer: n.data.demoAnswer,
        },
      })),
    }));
  }
  function onEdgesChange(changes: EdgeChange[]) {
    if (!busy && !run)
      setWorkflow((w) => ({
        ...w,
        edges: applyEdgeChanges(
          changes,
          w.edges as Edge[],
        ) as Workflow["edges"],
      }));
  }
  function saveWorkflow() {
    try {
      const valid = validateWorkflow(workflow);
      const saved = [
        {
          id: crypto.randomUUID(),
          savedAt: new Date().toISOString(),
          workflow: valid,
        },
        ...library,
      ].slice(0, 20);
      localStorage.setItem(LIBRARY, JSON.stringify(saved));
      setLibrary(saved);
      flash("Saved to your workflow library.");
    } catch (error) {
      flash((error as Error).message, true);
    }
  }
  function exportWorkflow() {
    try {
      const graph = validateWorkflow(workflow);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(graph, null, 2)], {
          type: "application/json",
        }),
      );
      const link = document.createElement("a");
      link.href = url;
      link.download = `${graph.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.json`;
      link.click();
      URL.revokeObjectURL(url);
      flash("Workflow exported.");
    } catch (error) {
      flash((error as Error).message, true);
    }
  }
  async function importWorkflow(file?: File) {
    if (!file) return;
    try {
      if (file.size > 150000)
        throw new Error("Choose a JSON file smaller than 150 KB.");
      replaceWorkflow(validateWorkflow(JSON.parse(await file.text())));
      flash("Workflow imported. Make it yours.");
    } catch (error) {
      flash(`Import failed: ${(error as Error).message}`, true);
    }
    if (fileInput.current) fileInput.current.value = "";
  }
  async function startRun(retry?: PublicRun) {
    try {
      if (!input.trim() && !retry)
        throw new Error("Add some input for your workflow to evaluate.");
      const graph = validateWorkflow(retry?.workflow || workflow);
      setSubmitting(true);
      setPanel("runner");
      setLogsOpen(true);
      const result = await api<PublicRun>("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workflow: graph,
          input: retry?.input || input,
          mode: retry?.mode || mode,
          retryOf: retry?.id,
        }),
      });
      setRun(result);
      refreshHistory();
    } catch (error) {
      flash((error as Error).message, true);
      refreshHistory();
    } finally {
      setSubmitting(false);
    }
  }
  const displayGraph = run?.workflow || workflow;
  const nodes: FlowNode[] = displayGraph.nodes.map((n) => {
    const logIndex = run?.logs.findIndex((l) => l.nodeId === n.id) ?? -1;
    const log = logIndex >= 0 ? run?.logs[logIndex] : undefined;
    return {
      ...n,
      measured: dimensions[n.id],
      selected: n.id === selected,
      data: {
        ...n.data,
        entry: n.id === displayGraph.startNodeId,
        state: log?.status,
        answer: log?.answer,
        order: log ? logIndex + 1 : undefined,
      },
    };
  });
  const edges: Edge[] = displayGraph.edges.map((e) => {
    const traversed = run?.logs.some(
      (l) => l.nodeId === e.source && l.answer === e.sourceHandle,
    );
    const color = e.sourceHandle === "YES" ? "#d9a56c" : "#8295b0";
    return {
      ...e,
      selected: e.id === selectedEdge,
      label: e.sourceHandle,
      type: "smoothstep",
      animated: !!traversed,
      style: {
        stroke: color,
        strokeWidth: traversed ? 2.5 : 1.3,
        opacity: run && !traversed ? 0.3 : 0.8,
      },
      markerEnd: { type: MarkerType.ArrowClosed, color },
      labelStyle: {
        fill: color,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: 1,
      },
      labelBgStyle: { fill: "#141414", fillOpacity: 1 },
      labelBgPadding: [8, 5],
    };
  });

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <aside className="sidebar glass">
        <a href="/" className="brand">
          <span className="brand-icon">
            <GitBranch size={23} />
          </span>
          <span>
            Ember<span className="brand-light">Path</span>
            <small>THE DECISION STUDIO</small>
          </span>
        </a>
        <div className="workspace-label">
          PERSONAL WORKSPACE <span>01</span>
        </div>
        <nav aria-label="Main navigation">
          <button
            className={tab === "editor" ? "nav-item active" : "nav-item"}
            onClick={() => setTab("editor")}
          >
            <WorkflowIcon size={17} />
            Workflow studio
            <ChevronRight size={14} />
          </button>
          <button
            className="nav-item"
            disabled={busy}
            onClick={() => setModal("library")}
          >
            <FolderOpen size={17} />
            My workflows<span className="nav-count">{library.length}</span>
          </button>
          <button
            className={tab === "history" ? "nav-item active" : "nav-item"}
            onClick={() => {
              setTab("history");
              refreshHistory();
            }}
          >
            <History size={17} />
            Run history<span className="nav-count">{history.length}</span>
          </button>
        </nav>
        <div className="sidebar-divider" />
        <div className="workspace-label">YOUR TOOLBOX</div>
        <button
          className="toolbox-card"
          onClick={() => {
            setTab("editor");
            addNode();
          }}
          disabled={busy}
        >
          <span className="toolbox-icon">
            <GitBranch size={19} />
          </span>
          <span>
            <strong>AI decision</strong>
            <small>One question. Two paths.</small>
          </span>
          <Plus size={15} />
        </button>
        <p className="sidebar-hint">
          Every great workflow starts
          <br />
          with a good question.
        </p>
        <div className="sidebar-bottom">
          <div className="little-card">
            <span className="little-spark">
              <Sparkles size={18} />
            </span>
            <h4>
              Small decisions.
              <br />
              Endless possibilities.
            </h4>
            <p>Let your ideas find their path.</p>
            <button onClick={() => setModal("guide")}>
              Explore the quick guide <ArrowRight size={13} />
            </button>
          </div>
          <button
            className="nav-item help-link"
            onClick={() => setModal("guide")}
          >
            <CircleHelp size={17} />A little guidance
            <ExternalLink size={13} />
          </button>
          <div className="profile">
            <span className="avatar">FE</span>
            <span>
              <strong>Faiza’s workspace</strong>
              <small>Made for curious minds</small>
            </span>
            <span className="profile-dot" />
          </div>
        </div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <ChevronRight size={12} />{" "}
            <span>{tab === "editor" ? "Workflow studio" : "Run history"}</span>
          </div>
          <div className="topbar-right">
            <span className="local-badge">
              <i /> LOCAL WORKSPACE
            </span>
            <a
              href="https://github.com/FaizaEsha/EmberPath"
              target="_blank"
              rel="noreferrer"
              aria-label="Open EmberPath on GitHub"
            >
              <GitBranch size={16} />
            </a>
          </div>
        </header>
        <section className="page-heading">
          <div>
            <div className="eyebrow">
              <span /> A LITTLE CLARITY, AT EVERY BRANCH
            </div>
            <h1>
              {tab === "editor" ? (
                <>
                  Ideas in. <em>Decisions out.</em>
                </>
              ) : (
                <>
                  Every run, <em>a story.</em>
                </>
              )}
            </h1>
            <p>
              {tab === "editor"
                ? "Turn a chain of questions into a thoughtful AI workflow."
                : "Revisit the questions, decisions, and paths your workflows took."}
            </p>
          </div>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => setModal("new")}
          >
            <Plus size={16} /> New workflow
          </Button>
        </section>
        {tab === "editor" ? (
          <>
            <section className="studio glass">
              <div className="studio-toolbar">
                <div className="workflow-title">
                  <span className="workflow-title-icon">
                    <WorkflowIcon size={17} />
                  </span>
                  <div>
                    <input
                      aria-label="Workflow name"
                      value={workflow.name}
                      disabled={busy || !!run}
                      maxLength={80}
                      onChange={(e) =>
                        setWorkflow((w) => ({ ...w, name: e.target.value }))
                      }
                    />
                    <span>
                      <i className={storageError ? "error-dot" : "saved-dot"} />
                      {storageError
                        ? "Browser storage is full"
                        : "Draft saved on this device"}
                    </span>
                  </div>
                </div>
                <div className="toolbar-actions">
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Import JSON"
                    aria-label="Import JSON"
                    disabled={busy}
                    onClick={() => fileInput.current?.click()}
                  >
                    <ArrowUpFromLine size={16} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    title="Export JSON"
                    aria-label="Export JSON"
                    onClick={exportWorkflow}
                  >
                    <ArrowDownToLine size={16} />
                  </Button>
                  <span className="toolbar-separator" />
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={saveWorkflow}
                  >
                    <Save size={14} />
                    Save
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={() => {
                      setPanel("runner");
                      setRun(null);
                    }}
                  >
                    <Play size={13} fill="currentColor" />
                    Run workflow
                  </Button>
                </div>
              </div>
              <div className="studio-body">
                <div className="canvas-area" ref={canvasRef}>
                  <div className="canvas-badge">
                    <span className="canvas-dot" />
                    {run
                      ? `${run.mode === "demo" ? "DEMO" : "LIVE"} EXECUTION`
                      : "WORKFLOW CANVAS"}
                    <span>{displayGraph.nodes.length} NODES</span>
                  </div>
                  {run && !busy && (
                    <button
                      className="back-to-edit"
                      onClick={() => {
                        setRun(null);
                        setPanel("inspector");
                      }}
                    >
                      {" "}
                      <MousePointer2 size={12} />
                      Back to editing
                    </button>
                  )}
                  <ReactFlow<FlowNode>
                    nodes={nodes}
                    edges={edges}
                    nodeTypes={nodeTypes}
                    onNodesChange={onNodesChange}
                    onEdgesChange={onEdgesChange}
                    onConnect={connect}
                    onNodeClick={(_, n) => {
                      setSelected(n.id);
                      setSelectedEdge(null);
                      if (!run) setPanel("inspector");
                    }}
                    onEdgeClick={(_, e) => {
                      if (!run) {
                        setSelectedEdge(e.id);
                        setSelected(null);
                        setPanel("inspector");
                      }
                    }}
                    onPaneClick={() => {
                      setSelected(null);
                      setSelectedEdge(null);
                    }}
                    nodesDraggable={!busy && !run}
                    nodesConnectable={!busy && !run}
                    edgesReconnectable={false}
                    deleteKeyCode={null}
                    fitView
                    fitViewOptions={{ padding: 0.16 }}
                    minZoom={0.25}
                    maxZoom={1.7}
                    colorMode="dark"
                    proOptions={{ hideAttribution: false }}
                  >
                    <Background
                      variant={BackgroundVariant.Dots}
                      gap={22}
                      size={1}
                      color="#35302b"
                    />
                    <Controls showInteractive={false} />
                    <MiniMap
                      pannable
                      zoomable
                      nodeColor="#8b6644"
                      maskColor="rgba(13,13,13,.75)"
                    />
                  </ReactFlow>
                  {!run && (
                    <button
                      className="add-node-floating"
                      onClick={addNode}
                      disabled={busy}
                    >
                      <Plus size={15} />
                      Add decision
                    </button>
                  )}
                  <div className="canvas-legend">
                    <span>
                      <i className="legend-yes" />
                      YES path
                    </span>
                    <span>
                      <i className="legend-no" />
                      NO path
                    </span>
                    <span className="canvas-tip">
                      Drag to arrange · Scroll to zoom
                    </span>
                  </div>
                </div>
                <aside className="inspector">
                  <div className="inspector-tabs">
                    <button
                      className={panel === "inspector" ? "selected" : ""}
                      onClick={() => setPanel("inspector")}
                    >
                      <Settings2 size={14} />
                      Inspector
                    </button>
                    <button
                      className={panel === "runner" ? "selected" : ""}
                      onClick={() => setPanel("runner")}
                    >
                      <Play size={13} />
                      Test run
                    </button>
                  </div>
                  <div className="inspector-content">
                    {panel === "inspector" ? (
                      node ? (
                        <>
                          <div className="inspector-heading">
                            <span className="inspector-symbol">
                              <GitBranch size={20} />
                            </span>
                            <span>
                              <h2>Shape the decision</h2>
                              <p>A clear question goes a long way.</p>
                            </span>
                          </div>
                          <label className="field-label" htmlFor="node-label">
                            NODE NAME{" "}
                            <span>
                              {node.id === workflow.startNodeId
                                ? "ENTRY"
                                : "DECISION"}
                            </span>
                          </label>
                          <input
                            id="node-label"
                            className="text-field"
                            value={node.data.label}
                            maxLength={80}
                            disabled={busy || !!run}
                            onChange={(e) =>
                              updateNode({ label: e.target.value })
                            }
                          />
                          <label className="field-label" htmlFor="node-prompt">
                            THE QUESTION <Sparkles size={12} />
                          </label>
                          <textarea
                            id="node-prompt"
                            className="text-field prompt-field"
                            value={node.data.prompt}
                            maxLength={2000}
                            disabled={busy || !!run}
                            onChange={(e) =>
                              updateNode({ prompt: e.target.value })
                            }
                          />
                          <p className="field-hint">
                            Ask a question that can be answered with a simple
                            YES or NO.
                          </p>
                          <div className="response-preview">
                            <span>
                              <Sparkles size={13} />
                              EXPECTED RESPONSE
                            </span>
                            <div>
                              <b>YES</b>
                              <span>or</span>
                              <b>NO</b>
                            </div>
                          </div>
                          <label className="field-label" htmlFor="demo-answer">
                            DEMO ANSWER <span>PRESET</span>
                          </label>
                          <select
                            id="demo-answer"
                            className="text-field"
                            disabled={busy || !!run}
                            value={node.data.demoAnswer}
                            onChange={(e) =>
                              updateNode({
                                demoAnswer: e.target.value as Answer,
                              })
                            }
                          >
                            <option>YES</option>
                            <option>NO</option>
                          </select>
                          <p className="field-hint">
                            Used only in Demo. Live AI evaluates your input.
                          </p>
                          <div className="node-actions">
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={
                                busy ||
                                !!run ||
                                node.id === workflow.startNodeId
                              }
                              onClick={() =>
                                setWorkflow((w) => ({
                                  ...w,
                                  startNodeId: node.id,
                                }))
                              }
                            >
                              <Zap size={12} />
                              Set as entry
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Delete selected node"
                              disabled={busy || !!run}
                              onClick={deleteNode}
                            >
                              <Trash2 size={14} />
                            </Button>
                          </div>
                        </>
                      ) : edge ? (
                        <>
                          <div className="inspector-heading">
                            <GitBranch />
                            <h2>A path between ideas</h2>
                          </div>
                          <p className="muted">
                            This connection follows the{" "}
                            <strong>{edge.sourceHandle}</strong> answer.
                          </p>
                          <label className="field-label" htmlFor="edge-answer">
                            BRANCH
                          </label>
                          <select
                            id="edge-answer"
                            className="text-field"
                            value={edge.sourceHandle}
                            onChange={(e) => {
                              try {
                                setWorkflow(
                                  validateWorkflow({
                                    ...workflow,
                                    edges: workflow.edges.map((x) =>
                                      x.id === edge.id
                                        ? { ...x, sourceHandle: e.target.value }
                                        : x,
                                    ),
                                  }),
                                );
                              } catch (error) {
                                flash((error as Error).message, true);
                              }
                            }}
                          >
                            <option>YES</option>
                            <option>NO</option>
                          </select>
                          <Button
                            variant="outline"
                            onClick={() => {
                              setWorkflow((w) => ({
                                ...w,
                                edges: w.edges.filter(
                                  (e) => e.id !== selectedEdge,
                                ),
                              }));
                              setSelectedEdge(null);
                            }}
                          >
                            <Trash2 size={14} />
                            Remove connection
                          </Button>
                        </>
                      ) : (
                        <div className="inspector-empty">
                          <MousePointer2 size={26} />
                          <h2>Pick a little possibility.</h2>
                          <p>
                            Select a decision to edit its question, or a
                            connection to change its path.
                          </p>
                          <Button
                            variant="outline"
                            onClick={addNode}
                            disabled={busy || !!run}
                          >
                            <Plus size={14} />
                            Add decision
                          </Button>
                        </div>
                      )
                    ) : (
                      <>
                        <div className="inspector-heading">
                          <span className="inspector-symbol">
                            <Play size={18} />
                          </span>
                          <span>
                            <h2>Follow the possibilities</h2>
                            <p>Give your workflow something to think about.</p>
                          </span>
                        </div>
                        <div
                          className="mode-switch"
                          aria-label="Execution mode"
                        >
                          <button
                            disabled={busy}
                            className={mode === "demo" ? "selected" : ""}
                            onClick={() => setMode("demo")}
                          >
                            <Zap size={13} />
                            Demo
                          </button>
                          <button
                            disabled={busy}
                            className={mode === "live" ? "selected" : ""}
                            onClick={() => setMode("live")}
                          >
                            <Sparkles size={13} />
                            Live AI
                          </button>
                        </div>
                        <label className="field-label" htmlFor="run-input">
                          WORKFLOW INPUT
                        </label>
                        <textarea
                          id="run-input"
                          className="text-field run-input"
                          value={input}
                          maxLength={12000}
                          disabled={busy}
                          onChange={(e) => setInput(e.target.value)}
                        />
                        <p className="field-hint">
                          {mode === "demo"
                            ? "Demo follows each node’s preset answer. No AI calls or API key required."
                            : "Your input is sent to OpenAI at each visited node. Requires a server-side API key."}
                        </p>
                        <Button
                          className="run-button"
                          disabled={busy}
                          onClick={() => startRun()}
                        >
                          {busy ? (
                            <Loader2 size={15} className="spin" />
                          ) : (
                            <Play size={14} fill="currentColor" />
                          )}
                          {busy
                            ? "Following the path…"
                            : mode === "demo"
                              ? "Run demo workflow"
                              : "Run with live AI"}
                          <ArrowRight size={15} />
                        </Button>
                        <div className="runtime-note">
                          <span className="runtime-icon">
                            <Zap size={15} />
                          </span>
                          <div>
                            <strong>Powered by Inngest</strong>
                            <p>
                              Every decision is a durable step, with automatic
                              retries when needed.
                            </p>
                          </div>
                        </div>
                        {run && (
                          <div className={`run-summary ${run.status}`}>
                            <span className="eyebrow">
                              {run.mode.toUpperCase()} EXECUTION
                            </span>
                            <h3>
                              {run.status === "completed"
                                ? "A path, found."
                                : run.status === "failed"
                                  ? "A little detour."
                                  : run.status === "queued"
                                    ? "Waiting to begin…"
                                    : "One decision at a time."}
                            </h3>
                            <p>
                              {run.error ||
                                (run.status === "completed"
                                  ? `${run.logs.length} decisions visited. An unconnected answer marks the end of this path.`
                                  : "Keep this window open to watch your decisions unfold.")}
                            </p>
                            {run.status === "failed" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => startRun(run)}
                                disabled={busy}
                              >
                                <RotateCcw size={12} />
                                Retry failed step
                              </Button>
                            )}
                            {run.status === "queued" && (
                              <p className="field-hint">
                                If this stays queued, start{" "}
                                <code>npm run inngest</code> in a second
                                terminal.
                              </p>
                            )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  <div className="inspector-bottom">
                    <span className="small-dot" /> Thoughtfully connected.
                  </div>
                </aside>
              </div>
              <div className="execution-panel">
                <button
                  className="execution-heading"
                  onClick={() => setLogsOpen((v) => !v)}
                >
                  <span>
                    <Terminal size={14} />
                    Execution log <b>{run?.logs.length || 0}</b>
                  </span>
                  <span className="execution-status">
                    {run ? run.status.toUpperCase() : "READY WHEN YOU ARE"}
                    <ChevronDown
                      size={14}
                      className={logsOpen ? "" : "collapsed"}
                    />
                  </span>
                </button>
                {logsOpen && (
                  <div className="execution-body">
                    {run?.logs.length ? (
                      <>
                        {run.logs.map((log, index) => (
                          <div className="log-line" key={log.nodeId}>
                            <span className="log-number">
                              {String(index + 1).padStart(2, "0")}
                            </span>
                            <span className={`log-state ${log.status}`}>
                              {log.status === "completed" ? (
                                <Check size={13} />
                              ) : log.status === "error" ? (
                                <X size={13} />
                              ) : (
                                <Loader2 className="spin" size={13} />
                              )}
                            </span>
                            <strong>{log.label}</strong>
                            <span>
                              {log.error ||
                                (log.status === "running"
                                  ? "Evaluating question…"
                                  : `${log.duration ?? 0} ms`)}
                            </span>
                            <b
                              className={`answer-chip ${log.answer === "NO" ? "no" : ""}`}
                            >
                              {log.answer || log.status}
                            </b>
                          </div>
                        ))}
                      </>
                    ) : (
                      <div className="log-empty">
                        <span className="terminal-prompt">›_</span>
                        <p>
                          Your next great decision starts here.
                          <span>Run a workflow to see each step unfold.</span>
                        </p>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setPanel("runner")}
                        >
                          Let’s try it <ArrowRight size={13} />
                        </Button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
            <div className="studio-footnote">
              <span>
                <GitBranch size={12} /> A question. A choice. A new direction.
              </span>
              <span>
                BUILT WITH INTENTION <span className="footnote-star">✳</span>
              </span>
            </div>
          </>
        ) : (
          <section className="history-panel glass">
            <div className="history-header">
              <h2>The paths you’ve taken</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refreshHistory()}
              >
                <RotateCcw size={13} />
                Refresh
              </Button>
            </div>
            {history.length ? (
              history.map((r) => (
                <button
                  key={r.id}
                  className="history-row"
                  onClick={() => {
                    setRun(r);
                    setWorkflow(r.workflow);
                    setSelected(r.workflow.startNodeId);
                    setInput(r.input);
                    setMode(r.mode);
                    setTab("editor");
                    setPanel("runner");
                    setTimeout(() => fitView({ padding: 0.18 }), 80);
                  }}
                >
                  <span className="history-icon">
                    <WorkflowIcon size={19} />
                  </span>
                  <span>
                    <strong>{r.workflow.name}</strong>
                    <small>
                      {new Date(r.createdAt).toLocaleString()} ·{" "}
                      {r.mode === "demo" ? "Preset demo" : "Live AI"}
                    </small>
                  </span>
                  <span className={`history-state ${r.status}`}>
                    {r.status}
                  </span>
                  <span>{r.logs.length} steps</span>
                  <ChevronRight size={15} />
                </button>
              ))
            ) : (
              <div className="history-empty">
                <History size={34} />
                <h2>A clean slate.</h2>
                <p>
                  Your workflow runs will appear here. Try your first decision.
                </p>
                <Button
                  onClick={() => {
                    setTab("editor");
                    setPanel("runner");
                  }}
                >
                  Run a workflow <ArrowRight size={14} />
                </Button>
              </div>
            )}
            <p className="history-note">
              Showing your latest 30 runs from this browser session. Run data
              stays on your local server.
            </p>
          </section>
        )}
      </main>
      <input
        ref={fileInput}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={(e) => importWorkflow(e.target.files?.[0])}
      />
      {notice && (
        <div
          className={`toast glass ${notice.error ? "toast-error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          {notice.error ? <CircleHelp size={18} /> : <CheckCheck size={18} />}
          <span>{notice.text}</span>
          <button
            aria-label="Dismiss notification"
            onClick={() => setNotice(null)}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <Dialog
        open={modal !== null}
        onOpenChange={(open) => {
          if (!open) setModal(null);
        }}
      >
        <DialogContent>
          {modal === "guide" ? (
            <>
              <span className="modal-icon">
                <BookOpen size={23} />
              </span>
              <DialogTitle>A little guidance.</DialogTitle>
              <DialogDescription>
                From your first question to a path full of possibilities.
              </DialogDescription>
              <div className="guide-steps">
                {[
                  [
                    "01",
                    "Ask a good question",
                    "Add a decision and write a question that AI can answer with YES or NO.",
                  ],
                  [
                    "02",
                    "Connect the possibilities",
                    "Drag from a node’s YES or NO port to another node’s left port. One connection per answer; loops are not allowed.",
                  ],
                  [
                    "03",
                    "Give it something to think about",
                    "Open Test run and paste a message. Demo uses your preset answers; Live AI reads your actual input.",
                  ],
                  [
                    "04",
                    "Follow the path",
                    "Inngest runs each decision as a step. An answer without a connection ends the workflow. Inspect results in the log.",
                  ],
                ].map(([n, title, text]) => (
                  <div key={n}>
                    <span>{n}</span>
                    <section>
                      <h3>{title}</h3>
                      <p>{text}</p>
                    </section>
                  </div>
                ))}
              </div>
              <div className="guide-tip">
                <Zap size={16} />
                <p>
                  Start both local servers: <code>npm run dev</code> and{" "}
                  <code>npm run inngest</code>. Add your OpenAI key to{" "}
                  <code>.env.local</code> for Live AI.
                </p>
              </div>
              <Button onClick={() => setModal(null)}>
                Find your flow <ArrowRight size={14} />
              </Button>
            </>
          ) : modal === "new" ? (
            <>
              <span className="modal-icon">
                <Sparkles size={23} />
              </span>
              <DialogTitle>A fresh possibility.</DialogTitle>
              <DialogDescription>
                Your current draft will be replaced. Save it to My workflows
                first if you’d like to keep it.
              </DialogDescription>
              <div className="new-workflow-options">
                <button
                  onClick={() =>
                    replaceWorkflow({
                      name: "Untitled workflow",
                      startNodeId: "first",
                      nodes: [
                        {
                          id: "first",
                          type: "decision",
                          position: { x: 200, y: 180 },
                          data: {
                            label: "Your first question",
                            prompt: emptyPrompt,
                            demoAnswer: "YES",
                          },
                        },
                      ],
                      edges: [],
                    })
                  }
                >
                  <Plus size={23} />
                  <h3>Start with a blank canvas</h3>
                  <p>Room for your next big idea.</p>
                  <ArrowRight size={16} />
                </button>
                <button onClick={() => replaceWorkflow(cloneStarter())}>
                  <WorkflowIcon size={23} />
                  <h3>Customer request triage</h3>
                  <p>A ready-to-explore decision workflow.</p>
                  <ArrowRight size={16} />
                </button>
              </div>
            </>
          ) : (
            <>
              <span className="modal-icon">
                <FolderOpen size={23} />
              </span>
              <DialogTitle>Your collection of possibilities.</DialogTitle>
              <DialogDescription>
                Saved workflows live in this browser. Export a JSON copy to take
                one with you.
              </DialogDescription>
              <div className="library-list">
                {library.length ? (
                  library.map((s) => (
                    <div key={s.id}>
                      <button
                        onClick={() =>
                          replaceWorkflow(structuredClone(s.workflow))
                        }
                      >
                        <WorkflowIcon size={18} />
                        <span>
                          <strong>{s.workflow.name}</strong>
                          <small>
                            {s.workflow.nodes.length} decisions ·{" "}
                            {new Date(s.savedAt).toLocaleDateString()}
                          </small>
                        </span>
                        <ArrowRight size={15} />
                      </button>
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Delete saved ${s.workflow.name}`}
                        onClick={() => {
                          try {
                            const saved = library.filter(
                              (item) => item.id !== s.id,
                            );
                            localStorage.setItem(
                              LIBRARY,
                              JSON.stringify(saved),
                            );
                            setLibrary(saved);
                          } catch {
                            flash("Could not update browser storage.", true);
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  ))
                ) : (
                  <div className="library-empty">
                    <FolderOpen size={30} />
                    <p>
                      No saved workflows yet. Your first idea deserves a place
                      here.
                    </p>
                  </div>
                )}
              </div>
              <Button
                variant="outline"
                onClick={() => {
                  setModal(null);
                  fileInput.current?.click();
                }}
              >
                <ArrowUpFromLine size={14} />
                Import a workflow
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
