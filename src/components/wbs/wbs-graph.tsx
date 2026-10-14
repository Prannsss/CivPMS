"use client";

/**
 * WBS graph view (spec §9.3): a top-down tree (project → deliverables → sub-deliverables → work
 * packages) laid out with d3-hierarchy and rendered with React Flow (pan, zoom, fit, minimap).
 * Cards show code, name, progress, status, cost and hours; branches collapse and expand.
 */
import "@xyflow/react/dist/style.css";
import { memo, useEffect, useMemo } from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
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
import { hierarchy, tree } from "d3-hierarchy";
import { ChevronDown, ChevronUp, FolderKanban, TriangleAlert } from "lucide-react";
import { Progress, StatusBadge } from "@/components/ui";
import {
  formatDuration,
  formatPercent,
  formatPeso,
  levelLabel,
  pluralize,
  type ActivityStatus,
  type Rollup,
} from "@/lib/domain";
import { cn } from "@/lib/utils";
import { RowActions } from "./row-actions";
import type { RollupMap, WbsNode } from "./types";
import { useWbs } from "./wbs-context";

const NODE_W = 248;
const NODE_H = 148;
const GAP_X = 28;
const GAP_Y = 64;
const ROOT_ID = "__project";

type ActivityNodeData = {
  kind: "activity";
  node: WbsNode;
  rollup: Rollup | undefined;
  collapsed: boolean;
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

type LayoutItem = { id: string; node: WbsNode | null; children: LayoutItem[] };

function toLayoutItems(nodes: WbsNode[], collapsed: ReadonlySet<string>): LayoutItem[] {
  return nodes.map((node) => ({
    id: node.id,
    node,
    children: collapsed.has(node.id) ? [] : toLayoutItems(node.children, collapsed),
  }));
}

function layout(
  projectName: string,
  roots: WbsNode[],
  rollups: RollupMap,
  collapsed: ReadonlySet<string>,
): { nodes: GraphNode[]; edges: Edge[] } {
  const root = hierarchy<LayoutItem>({ id: ROOT_ID, node: null, children: toLayoutItems(roots, collapsed) });
  tree<LayoutItem>()
    .nodeSize([NODE_W + GAP_X, NODE_H + GAP_Y])
    .separation((a, b) => (a.parent === b.parent ? 1 : 1.12))(root);

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
  root.each((d) => {
    const position = { x: (d.x ?? 0) - NODE_W / 2, y: (d.y ?? 0) };
    if (d.data.node === null) {
      nodes.push({
        id: ROOT_ID,
        type: "project",
        position,
        data: {
          kind: "project",
          name: projectName,
          cost,
          hours,
          percent: weight > 0 ? weighted / weight : 0,
          deliverables: roots.length,
        },
        draggable: false,
        selectable: false,
      });
    } else {
      const node = d.data.node;
      nodes.push({
        id: node.id,
        type: "activity",
        position,
        data: { kind: "activity", node, rollup: rollups.get(node.id), collapsed: collapsed.has(node.id) },
        draggable: false,
        selectable: false,
      });
    }
    if (d.parent) {
      const hasDelayed = d.data.node ? rollups.get(d.data.node.id)?.hasDelayed : false;
      edges.push({
        id: `${d.parent.data.id}->${d.data.id}`,
        source: d.parent.data.id,
        target: d.data.id,
        type: "smoothstep",
        style: hasDelayed ? { stroke: "var(--danger)", strokeOpacity: 0.55 } : undefined,
      });
    }
  });
  return { nodes, edges };
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
  const { nodes, edges } = useMemo(
    () => layout(projectName, roots, rollups, collapsed),
    [projectName, roots, rollups, collapsed],
  );

  return (
    <div
      data-testid="wbs-graph"
      role="region"
      aria-label="Work breakdown graph"
      className="wbs-graph h-[calc(100dvh-15rem)] min-h-[28rem] w-full overflow-hidden rounded-lg border border-border bg-surface-muted shadow-xs"
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
          fitView
          fitViewOptions={{ padding: 0.15, maxZoom: 1 }}
          minZoom={0.15}
          maxZoom={1.75}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable={false}
          edgesFocusable={false}
          proOptions={{ hideAttribution: true }}
          panOnScroll={false}
          zoomOnDoubleClick={false}
        >
          <FitOnShapeChange count={nodes.length} />
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} />
          <Controls showInteractive={false} position="bottom-left" />
          <MiniMap
            pannable
            zoomable
            position="bottom-right"
            className="!hidden overflow-hidden rounded-md border border-border sm:!block"
            nodeBorderRadius={8}
            ariaLabel="Mini map of the work breakdown"
          />
        </ReactFlow>
      </ReactFlowProvider>
    </div>
  );
}

/** Re-fit when branches are collapsed/expanded or items are added/removed. */
function FitOnShapeChange({ count }: { count: number }) {
  const { fitView } = useReactFlow();
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      void fitView({ padding: 0.15, maxZoom: 1, duration: 200 });
    });
    return () => cancelAnimationFrame(frame);
  }, [count, fitView]);
  return null;
}

const hiddenHandle = "!size-1 !min-h-0 !min-w-0 !border-0 !bg-transparent";

function ProjectCard({ data }: NodeProps<Node<ProjectNodeData, "project">>) {
  const wbs = useWbs();
  return (
    <div
      className="flex flex-col gap-3 rounded-xl bg-primary p-4 text-primary-foreground shadow-md"
      style={{ width: NODE_W, height: NODE_H }}
    >
      <div className="flex items-center gap-2">
        <span className="grid size-8 shrink-0 place-items-center rounded-md bg-white/15">
          <FolderKanban aria-hidden className="size-4" />
        </span>
        <div className="flex min-w-0 flex-col">
          <span className="text-[11px] leading-4 font-medium tracking-wide text-white/85 uppercase">Project</span>
          <span className="truncate text-sm leading-5 font-semibold" title={data.name}>
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
      <div className="mt-auto flex items-end justify-between gap-2 text-xs leading-4 tabular-nums">
        <span className="text-white/90">{pluralize(data.deliverables, "deliverable")}</span>
        <span className="flex flex-col items-end">
          <span className="font-semibold">{formatPeso(data.cost)}</span>
          <span className="text-white/90">{formatDuration(data.hours, wbs.unit, wbs.hoursPerDay)}</span>
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} isConnectable={false} className={hiddenHandle} />
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
        "relative flex flex-col gap-2 overflow-hidden rounded-xl border border-border bg-surface p-3.5 pl-4 text-foreground shadow-sm",
        "before:absolute before:inset-y-0 before:left-0 before:w-1",
        LEVEL_ACCENT[node.level] ?? LEVEL_ACCENT[3],
      )}
      style={{ width: NODE_W, height: NODE_H }}
    >
      <Handle type="target" position={Position.Top} isConnectable={false} className={hiddenHandle} />
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-[11px] leading-4 text-muted-foreground">
            <span className="font-mono font-medium tabular-nums">{node.wbsCode}</span>
            <span aria-hidden>·</span>
            <span className="truncate">{levelLabel(node.level)}</span>
          </span>
          <span
            className={cn("line-clamp-2 text-[13px] leading-[1.15rem]", node.level === 1 ? "font-semibold" : "font-medium")}
            title={node.name}
          >
            {node.name}
          </span>
        </div>
        <RowActions node={node} className="-mt-1 -mr-1.5 shrink-0" />
      </div>
      <div className="flex items-center gap-2">
        <Progress value={rollup?.percent ?? 0} size="sm" className="flex-1" aria-label={`Progress of ${code}`} />
        <span className="w-9 text-right text-xs font-medium text-muted-foreground tabular-nums">
          {formatPercent(rollup?.percent ?? 0)}
        </span>
      </div>
      <div className="mt-auto flex items-end justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          <StatusBadge status={delayedLeaf ? "delayed" : status} size="sm" />
          {!isLeaf && rollup?.hasDelayed ? (
            <span className="inline-flex text-danger-text" title="Contains delayed work packages">
              <TriangleAlert aria-hidden className="size-3.5" />
              <span className="sr-only">Contains delayed work packages</span>
            </span>
          ) : null}
        </div>
        <span className="flex shrink-0 flex-col items-end text-[11px] leading-4 tabular-nums">
          <span className="font-semibold text-foreground">{formatPeso(rollup?.cost ?? node.estCost ?? 0)}</span>
          <span className="text-muted-foreground">
            {formatDuration(rollup?.hours ?? node.durationHours ?? 0, wbs.unit, wbs.hoursPerDay)}
          </span>
        </span>
      </div>
      {!isLeaf ? (
        <button
          type="button"
          onClick={() => wbs.toggle(node.id)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${code}`}
          className="nodrag nopan absolute bottom-0 left-1/2 inline-flex h-5 -translate-x-1/2 items-center gap-1 rounded-t-md border border-b-0 border-border bg-surface-muted px-2 text-[11px] leading-none font-medium text-muted-foreground hover:bg-surface-sunken hover:text-foreground focus-ring"
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
      <Handle type="source" position={Position.Bottom} isConnectable={false} className={hiddenHandle} />
    </div>
  );
}
