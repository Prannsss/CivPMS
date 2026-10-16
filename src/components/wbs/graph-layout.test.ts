import { describe, expect, it } from "vitest";
import { GRAPH_NODE, layoutTree, type LayoutInput } from "./graph-layout";

const leaf = (id: string): LayoutInput => ({ id, children: [] });
const { width: W, height: H } = GRAPH_NODE;

describe("layoutTree", () => {
  it("places a lone root", () => {
    expect(layoutTree(leaf("p"))).toEqual({
      nodes: [{ id: "p", x: 0, y: 0, parentId: null, edge: null, stacksChildren: false }],
      width: W,
      height: H,
    });
  });

  it("puts deliverables in a row and stacks leaf-only children", () => {
    const layout = layoutTree({
      id: "p",
      children: [
        { id: "1", children: [leaf("1.1"), leaf("1.2")] },
        { id: "2", children: [{ id: "2.1", children: [leaf("2.1.1")] }, leaf("2.2")] },
      ],
    });
    const byId = new Map(layout.nodes.map((n) => [n.id, n]));
    // Root is centred over the row of deliverables.
    expect(byId.get("p")!.x).toBeCloseTo(layout.width / 2 - W / 2);
    // Deliverable 1 stacks its two work packages, indented under it.
    const d1 = byId.get("1")!;
    expect(d1.stacksChildren).toBe(true);
    expect(byId.get("1.1")).toMatchObject({ edge: "stack", x: d1.x + 28 });
    expect(byId.get("1.2")!.y).toBeGreaterThan(byId.get("1.1")!.y);
    // Deliverable 2 has a sub-deliverable, so its children form a row.
    const d2 = byId.get("2")!;
    expect(d2.stacksChildren).toBe(false);
    expect(byId.get("2.1")!.y).toBe(byId.get("2.2")!.y);
    expect(byId.get("2.1")).toMatchObject({ edge: "row" });
    expect(byId.get("2.1.1")).toMatchObject({ edge: "stack", parentId: "2.1" });
    // Nothing overlaps horizontally on the same row.
    expect(d2.x).toBeGreaterThanOrEqual(d1.x + W);
    expect(layout.height).toBeGreaterThan(3 * H);
  });
});
