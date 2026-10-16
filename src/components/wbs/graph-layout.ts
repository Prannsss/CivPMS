/**
 * Top-down WBS tree layout for the graph view (pure; d3-hierarchy for the traversal).
 *
 * Branches whose children are all leaves stack those children vertically under the parent
 * (an indented column), everything else lays its children out in a row. That keeps a typical
 * WBS (a few deliverables, many work packages) readable without zooming out to a thin strip.
 */
import { hierarchy, type HierarchyNode } from "d3-hierarchy";

export const GRAPH_NODE = { width: 240, height: 124 } as const;
const GAP_X = 32;
const GAP_Y = 56;
const STACK_INDENT = 28;
const STACK_GAP = 14;

export interface LayoutInput {
  id: string;
  children: LayoutInput[];
}

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
  parentId: string | null;
  /** How the edge from the parent arrives: from above ("row") or from the left ("stack"). */
  edge: "row" | "stack" | null;
  /** This node's children are stacked under it (its outgoing edges leave from the bottom-left). */
  stacksChildren: boolean;
}

export interface GraphLayout {
  nodes: PlacedNode[];
  width: number;
  height: number;
}

type Box = { w: number; h: number; mode: "leaf" | "row" | "stack"; left: number; top: number };

export function layoutTree(root: LayoutInput): GraphLayout {
  const { width: W, height: H } = GRAPH_NODE;
  const tree = hierarchy<LayoutInput>(root, (d) => (d.children.length > 0 ? d.children : null));
  const boxes = new Map<HierarchyNode<LayoutInput>, Box>();

  tree.eachAfter((d) => {
    const kids = d.children ?? [];
    if (kids.length === 0) {
      boxes.set(d, { w: W, h: H, mode: "leaf", left: 0, top: 0 });
    } else if (d.parent && kids.every((k) => !k.children)) {
      boxes.set(d, { w: STACK_INDENT + W, h: H + kids.length * (STACK_GAP + H), mode: "stack", left: 0, top: 0 });
    } else {
      const rowW = kids.reduce((sum, k) => sum + boxes.get(k)!.w, 0) + GAP_X * (kids.length - 1);
      const tallest = Math.max(...kids.map((k) => boxes.get(k)!.h));
      boxes.set(d, { w: Math.max(W, rowW), h: H + GAP_Y + tallest, mode: "row", left: 0, top: 0 });
    }
  });

  const nodes: PlacedNode[] = [];
  tree.eachBefore((d) => {
    const box = boxes.get(d)!;
    const parentBox = d.parent ? boxes.get(d.parent)! : null;
    const x = box.mode === "stack" ? box.left : box.left + box.w / 2 - W / 2;
    nodes.push({
      id: d.data.id,
      x,
      y: box.top,
      parentId: d.parent ? d.parent.data.id : null,
      edge: parentBox ? (parentBox.mode === "stack" ? "stack" : "row") : null,
      stacksChildren: box.mode === "stack",
    });
    const kids = d.children ?? [];
    if (box.mode === "stack") {
      kids.forEach((k, i) => {
        const kb = boxes.get(k)!;
        kb.left = box.left + STACK_INDENT;
        kb.top = box.top + H + STACK_GAP + i * (H + STACK_GAP);
      });
    } else if (box.mode === "row") {
      const rowW = kids.reduce((sum, k) => sum + boxes.get(k)!.w, 0) + GAP_X * (kids.length - 1);
      let cursor = box.left + (box.w - rowW) / 2;
      for (const k of kids) {
        const kb = boxes.get(k)!;
        kb.left = cursor;
        kb.top = box.top + H + GAP_Y;
        cursor += kb.w + GAP_X;
      }
    }
  });

  const rootBox = boxes.get(tree)!;
  return { nodes, width: rootBox.w, height: rootBox.h };
}
