"use client";

/**
 * WBS graph view (spec §9.3): a top-down tree (project → deliverables → sub-deliverables → work
 * packages) laid out with d3-hierarchy and rendered with React Flow (pan, zoom, fit, minimap).
 * Cards show code, name, progress, status, cost and hours; branches collapse and expand.
 */
import "@xyflow/react/dist/style.css";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  ControlButton,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import { ChevronDown, ChevronUp, FolderKanban, Fullscreen, TriangleAlert } from "lucide-react";
import { Progress, StatusBadge } from "@/components/ui";
import {
  formatDuration,
  formatPercent,
  formatPeso,
  pluralize,
  type ActivityStatus,
  type Rollup,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import { GRAPH_NODE, layoutTree, type LayoutInput } from "./graph-layout";
import { nodeLabel } from "./model";
import { RowActions } from "./row-actions";
import type { RollupMap, WbsNode } from "./types";
import { useWbs } from "./wbs-context";

const NODE_W = GRAPH_NODE.width;
const NODE_H = GRAPH_NODE.height;
const ROOT_ID = "__project";

type ActivityNodeData = {
  kind: "activity";
  node: WbsNode;
  rollup: Rollup | undefined;
  collapsed: boolean;
  stacksChildren: boolean;
};
type ProjectNodeData = {
  kind: "project";
  name: string;
  cost: number;
  percent: number;
  hours: number;
  deliverables: number;
};
type GraphNode = Node<ActivityNodeData, "activity"> | Node<ProjectNodeData, "project">;

function toLayoutInput(nodes: WbsNode[], collapsed: ReadonlySet<string>): LayoutInput[] {
  return nodes.map((node) => ({
    id: node.id,
    children: collapsed.has(node.id) ? [] : toLayoutInput(node.children, collapsed),
  }));
}

function indexNodes(nodes: WbsNode[], into = new Map<string, WbsNode>()): Map<string, WbsNode> {
  for (const node of nodes) {
    into.set(node.id, node);
    indexNodes(node.children, into);
  }
  return into;
}

function buildGraph(
  projectName: string,
  roots: WbsNode[],
  rollups: RollupMap,
  collapsed: ReadonlySet<string>,
): { nodes: GraphNode[]; edges: Edge[]; width: number; height: number } {
  const layout = layoutTree({ id: ROOT_ID, children: toLayoutInput(roots, collapsed) });
  const byId = indexNodes(roots);

  let cost = 0;
  let hours = 0;
  let weighted = 0;
  let weight = 0;
  for (const r of roots) {
    const rollup = rollups.get(r.id);
    if (!rollup) continue;
    cost += rollup.cost;
    hours += rollup.hours;
    weighted += rollup.percent * rollup.weight;
    weight += rollup.weight;
  }

  const nodes: GraphNode[] = [];
  const edges: Edge[] = [];
  for (const placed of layout.nodes) {
    const position = { x: placed.x, y: placed.y };
    // React Flow turns pointer events off for nodes that are neither draggable nor selectable;
    // the cards still need them for the actions menu and the collapse toggle.
    const common = {
      position,
      width: NODE_W,
      height: NODE_H,
      draggable: false,
      selectable: false,
      style: { pointerEvents: "all" as const },
    };
    if (placed.id === ROOT_ID) {
      nodes.push({
        ...common,
        id: ROOT_ID,
        type: "project",
        data: {
          kind: "project",
          name: projectName,
          cost,
          hours,
          percent: weight > 0 ? weighted / weight : 0,
          deliverables: roots.length,
        },
      });
    } else {
      const node = byId.get(placed.id)!;
      nodes.push({
        ...common,
        id: node.id,
        type: "activity",
        data: {
          kind: "activity",
          node,
          rollup: rollups.get(node.id),
          collapsed: collapsed.has(node.id),
          stacksChildren: placed.stacksChildren,
        },
      });
    }
    if (placed.parentId) {
      const hasDelayed = rollups.get(placed.id)?.hasDelayed;
      edges.push({
        id: `${placed.parentId}->${placed.id}`,
        source: placed.parentId,
        target: placed.id,
        sourceHandle: placed.edge === "stack" ? "stack" : "bottom",
        targetHandle: placed.edge === "stack" ? "left" : "top",
        type: placed.edge === "stack" ? "step" : "smoothstep",
        style: hasDelayed ? { stroke: "var(--danger)", strokeOpacity: 0.6 } : undefined,
      });
    }
  }
  return { nodes, edges, width: layout.width, height: layout.height };
}

const nodeTypes = { activity: memo(ActivityCard), project: memo(ProjectCard) };

export function WbsGraph({
  projectName,
  roots,
  rollups,
  collapsed,
}: {
  projectName: string;
  roots: WbsNode[];
  rollups: RollupMap;
  collapsed: ReadonlySet<string>;
}) {
  const { nodes, edges, width, height } = useMemo(
    () => buildGraph(projectName, roots, rollups, collapsed),
    [projectName, roots, rollups, collapsed],
  );
  const containerRef = useRef<HTMLDivElement>(null);

  return (
    <div
      ref={containerRef}
      data-testid="wbs-graph"
      role="region"
      aria-label="Work breakdown graph"
      className="h-[calc(100dvh-14rem)] min-h-[30rem] w-full overflow-hidden rounded-lg border border-border bg-surface-muted shadow-xs"
      style={
        {
          "--xy-background-color": "var(--surface-muted)",
          "--xy-background-pattern-color": "var(--border-strong)",
          "--xy-edge-stroke": "var(--border-strong)",
          "--xy-edge-stroke-width": "1.5",
          "--xy-controls-button-background-color": "var(--surface)",
          "--xy-controls-button-background-color-hover": "var(--surface-sunken)",
          "--xy-controls-button-color": "var(--foreground)",
          "--xy-controls-button-color-hover": "var(--foreground)",
          "--xy-controls-button-border-color": "var(--border)",
          "--xy-controls-box-shadow": "var(--elev-sm)",
          "--xy-minimap-background-color": "var(--surface)",
          "--xy-minimap-mask-background-color": "color-mix(in oklab, var(--surface-sunken) 70%, transparent)",
          "--xy-minimap-node-background-color": "var(--border-strong)",
          "--xy-attribution-background-color": "transparent",
        } as React.CSSProperties
      }
    >
      <ReactFlowProvider>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          minZoom={0.2}
          maxZoom={1.75}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          attributionPosition="top-right"
          zoomOnDoubleClick={false}
        >
          <TopFit containerRef={containerRef} width={width} height={height} />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="!hidden overflow-hidden rounded-md border border-border sm:!block"
            nodeBorderRadius={10}
            ariaLabel="Mini map of the work breakdown"
            style={{ width: 168, height: 112 }}
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

/**
 * Fits the tree into the view anchored at the top (the project card stays visible) and offers a
 * "Fit" control. Re-fits when branches are collapsed or items are added/removed.
 */
function TopFit({
  containerRef,
  width,
  height,
}: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  width: number;
  height: number;
}) {
  const { setViewport } = useReactFlow();
  /**
   * "width": readable cards (≥ 50 % zoom) anchored at the top with the project card centred; the
   * rest of the tree is a pan or scroll away. "all": the whole tree, however small.
   */
  const fit = useCallback(
    (mode: "width" | "all", duration: number) => {
      const box = containerRef.current?.getBoundingClientRect();
      if (!box || box.width === 0) return;
      const pad = 32;
      const zoomW = (box.width - pad * 2) / width;
      const zoomH = (box.height - pad * 2) / height;
      const zoom =
        mode === "all"
          ? Math.max(0.2, Math.min(1, zoomW, zoomH))
          : Math.max(0.5, Math.min(1, zoomW));
      const x = (box.width - width * zoom) / 2;
      void setViewport({ x, y: pad, zoom }, { duration });
    },
    [containerRef, width, height, setViewport],
  );
  // `fit` changes only when the tree's size changes (collapse/expand, add/remove), not on value edits.
  useEffect(() => {
    const frame = requestAnimationFrame(() => fit("width", 0));
    return () => cancelAnimationFrame(frame);
  }, [fit]);
  return (
    <Controls showInteractive={false} showFitView={false} position="bottom-left" aria-label="Zoom controls">
      <ControlButton onClick={() => fit("all", 200)} aria-label="Fit the whole tree" title="Fit the whole tree">
        <Fullscreen />
      </ControlButton>
    </Controls>
  );
}

const hiddenHandle = "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

function ProjectCard({ data }: NodeProps<Node<ProjectNodeData, "project">>) {
  const wbs = useWbs();
  return (
    <div
      className="flex flex-col gap-2.5 rounded-xl bg-primary p-3.5 text-primary-foreground shadow-md"
      style={{ width: NODE_W, height: NODE_H }}
    >
      <div className="flex items-center gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-white/15">
          <FolderKanban aria-hidden className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] leading-4 font-medium text-white/85">Project</span>
          <span className="truncate text-[13px] leading-5 font-semibold" title={data.name}>
            {data.name}
          </span>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <div aria-hidden className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/25">
          <div className="h-full rounded-full bg-white" style={{ width: `${Math.min(100, data.percent)}%` }} />
        </div>
        <span className="text-xs font-semibold tabular-nums">{formatPercent(data.percent)}</span>
      </div>
      <div className="mt-auto flex items-end justify-between gap-2 text-[11px] leading-4 tabular-nums">
        <span className="text-white/90">{pluralize(data.deliverables, "deliverable")}</span>
        <span className="flex flex-col items-end">
          <span className="text-xs font-semibold">{formatPeso(data.cost)}</span>
          <span className="text-white/90">{formatDuration(data.hours, wbs.unit, wbs.hoursPerDay)}</span>
        </span>
      </div>
      <Handle id="bottom" type="source" position={Position.Bottom} isConnectable={false} className={hiddenHandle} />
    </div>
  );
}

const LEVEL_ACCENT: Record<number, string> = {
  1: "before:bg-primary",
  2: "before:bg-info",
  3: "before:bg-border-strong",
};

function ActivityCard({ data }: NodeProps<Node<ActivityNodeData, "activity">>) {
  const wbs = useWbs();
  const { node, rollup, collapsed } = data;
  const isLeaf = node.children.length === 0;
  const status: ActivityStatus = rollup?.status ?? node.status;
  const delayedLeaf = isLeaf && rollup?.hasDelayed;
  const code = `${node.wbsCode} ${node.name}`;

  return (
    <div
      data-testid="wbs-graph-node"
      data-wbs-code={node.wbsCode}
      className={cn(
        "relative flex flex-col gap-1.5 rounded-xl border border-border bg-surface py-2.5 pr-2 pl-3.5 text-foreground shadow-sm",
        "before:absolute before:inset-y-0 before:-left-px before:w-1 before:rounded-l-xl",
        LEVEL_ACCENT[isLeaf && node.level > 1 ? 3 : node.level] ?? LEVEL_ACCENT[3],
      )}
      style={{ width: NODE_W, height: NODE_H }}
    >
      <Handle id="top" type="target" position={Position.Top} isConnectable={false} className={hiddenHandle} />
      <Handle id="left" type="target" position={Position.Left} isConnectable={false} className={hiddenHandle} />
      <div className="flex items-start gap-1">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span className="font-mono font-medium tabular-nums">{node.wbsCode}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{nodeLabel(node)}</span>
            <span aria-hidden>·</span>
            <span className="shrink-0 tabular-nums">
              {formatDuration(rollup?.hours ?? node.durationHours ?? 0, wbs.unit, wbs.hoursPerDay)}
            </span>
          </span>
          <span
            className={cn("line-clamp-2 text-[13px] leading-[1.1rem]", node.level === 1 ? "font-semibold" : "font-medium")}
            title={node.name}
          >
            {node.name}
          </span>
        </div>
        <RowActions node={node} className="-mt-1 size-8 shrink-0" />
      </div>
      <div className="mt-auto flex items-center gap-2 pr-1.5">
        <Progress value={rollup?.percent ?? 0} size="sm" className="flex-1" aria-label={`Progress of ${code}`} />
        <span className="w-8 text-right text-[11px] font-medium text-muted-foreground tabular-nums">
          {formatPercent(rollup?.percent ?? 0)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 pr-1.5">
        <div className="flex min-w-0 items-center gap-1">
          <StatusBadge status={delayedLeaf ? "delayed" : status} size="sm" />
          {!isLeaf && rollup?.hasDelayed ? (
            <span className="inline-flex text-danger-text" title="Contains delayed work packages">
              <TriangleAlert aria-hidden className="size-3.5" />
              <span className="sr-only">Contains delayed work packages</span>
            </span>
          ) : null}
        </div>
        <span className="shrink-0 text-xs leading-4 font-semibold text-foreground tabular-nums">
          {formatPeso(rollup?.cost ?? node.estCost ?? 0)}
        </span>
      </div>
      {!isLeaf ? (
        <button
          type="button"
          onClick={() => wbs.toggle(node.id)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${code}`}
          className="nodrag nopan absolute -bottom-3 left-1/2 z-10 inline-flex h-6 min-w-6 -translate-x-1/2 items-center justify-center gap-0.5 rounded-full border border-border-strong bg-surface px-1.5 text-[11px] leading-none font-semibold text-muted-foreground shadow-xs hover:bg-surface-sunken hover:text-foreground focus-ring"
        >
          {collapsed ? (
            <>
              <ChevronDown aria-hidden className="size-3" /> {node.children.length}
            </>
          ) : (
            <ChevronUp aria-hidden className="size-3" />
          )}
        </button>
      ) : null}
      <Handle id="bottom" type="source" position={Position.Bottom} isConnectable={false} className={hiddenHandle} />
      <Handle
        id="stack"
        type="source"
        position={Position.Bottom}
        isConnectable={false}
        className={hiddenHandle}
        style={{ left: 14 }}
      />
    </div>
  );
}
