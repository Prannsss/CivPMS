import { describe, expect, it } from "vitest";
import { record } from "./test-fixtures";
import {
  ancestorsOf,
  buildTree,
  canMove,
  canMoveMessage,
  childLevelLabel,
  compareSiblings,
  computeWbsCodes,
  countDescendantsByLevel,
  depthOf,
  descendantsOf,
  describeDeleteImpact,
  findNode,
  flattenTree,
  leavesOf,
  levelLabel,
  subtreeHeight,
  type ActivityNode,
  type ActivityRecord,
} from "./wbs";

/*
 * Fixture tree:
 * 1 A
 *   1.1 A1
 *     1.1.1 A1a
 *     1.1.2 A1b
 *   1.2 A2
 * 2 B
 * 3 C
 *   3.1 C1
 */
function fixture(): ActivityRecord[] {
  return [
    record({ id: "C", sortOrder: 3 }),
    record({ id: "A1b", parentId: "A1", sortOrder: 2 }),
    record({ id: "A", sortOrder: 1 }),
    record({ id: "A2", parentId: "A", sortOrder: 2 }),
    record({ id: "B", sortOrder: 2 }),
    record({ id: "A1", parentId: "A", sortOrder: 1 }),
    record({ id: "C1", parentId: "C", sortOrder: 1 }),
    record({ id: "A1a", parentId: "A1", sortOrder: 1 }),
  ];
}

function codesOf(roots: ActivityNode[]): Record<string, string> {
  return Object.fromEntries(computeWbsCodes(roots));
}

describe("buildTree", () => {
  it("nests, sorts and assigns levels and WBS codes", () => {
    const { roots, orphanIds } = buildTree(fixture());
    expect(orphanIds).toEqual([]);
    expect(roots.map((r) => r.id)).toEqual(["A", "B", "C"]);
    expect(roots[0]!.children.map((c) => c.id)).toEqual(["A1", "A2"]);
    const a1a = findNode(roots, "A1a")!;
    expect(a1a.level).toBe(3);
    expect(a1a.wbsCode).toBe("1.1.1");
    expect(findNode(roots, "C1")!.wbsCode).toBe("3.1");
    expect(codesOf(roots)).toEqual({
      A: "1",
      A1: "1.1",
      A1a: "1.1.1",
      A1b: "1.1.2",
      A2: "1.2",
      B: "2",
      C: "3",
      C1: "3.1",
    });
  });

  it("orders ties by name, then id", () => {
    const { roots } = buildTree([
      record({ id: "z", sortOrder: 1, name: "Beta" }),
      record({ id: "y", sortOrder: 1, name: "Alpha" }),
      record({ id: "x2", sortOrder: 1, name: "Alpha" }),
      record({ id: "x1", sortOrder: 1, name: "Alpha" }),
      record({ id: "x1", sortOrder: 1, name: "Duplicate id is ignored" }),
    ]);
    expect(roots.map((r) => r.id)).toEqual(["x1", "x2", "y", "z"]);
    expect(compareSiblings({ id: "a", sortOrder: 1, name: "n" }, { id: "a", sortOrder: 1, name: "n" })).toBe(0);
  });

  it("renumbers WBS codes after a reorder", () => {
    const records = fixture().map((r) => (r.id === "A" ? { ...r, sortOrder: 10 } : r));
    const { roots } = buildTree(records);
    expect(roots.map((r) => r.id)).toEqual(["B", "C", "A"]);
    expect(findNode(roots, "A1b")!.wbsCode).toBe("3.1.2");
    const swapped = fixture().map((r) =>
      r.id === "A1a" ? { ...r, sortOrder: 5 } : r,
    );
    const tree = buildTree(swapped).roots;
    expect(findNode(tree, "A1b")!.wbsCode).toBe("1.1.1");
    expect(findNode(tree, "A1a")!.wbsCode).toBe("1.1.2");
  });

  it("ignores soft-deleted rows and everything below them", () => {
    const records = fixture().map((r) => (r.id === "A1" ? { ...r, deletedAt: "2026-10-10T00:00:00Z" } : r));
    const { roots, orphanIds } = buildTree(records);
    expect(orphanIds).toEqual([]);
    expect(findNode(roots, "A1")).toBeNull();
    expect(findNode(roots, "A1a")).toBeNull();
    expect(findNode(roots, "A2")!.wbsCode).toBe("1.1");
  });

  it("attaches orphans (missing parent) as roots and reports them", () => {
    const { roots, orphanIds } = buildTree([
      record({ id: "A", sortOrder: 1 }),
      record({ id: "lost", parentId: "ghost", sortOrder: 1 }),
      record({ id: "lostChild", parentId: "lost", sortOrder: 1 }),
    ]);
    expect(orphanIds).toEqual(["lost"]);
    expect(roots.map((r) => r.id)).toEqual(["A", "lost"]);
    expect(findNode(roots, "lostChild")!.wbsCode).toBe("2.1");
  });

  it("breaks parent cycles instead of looping", () => {
    const { roots, orphanIds } = buildTree([
      record({ id: "dangling", parentId: "p", sortOrder: 1 }),
      record({ id: "p", parentId: "q", sortOrder: 1 }),
      record({ id: "q", parentId: "p", sortOrder: 2 }),
      record({ id: "self", parentId: "self", sortOrder: 3 }),
    ]);
    // Walking up from "dangling": p → q → p repeats, so p is promoted to a root.
    expect(orphanIds).toEqual(["p", "self"]);
    expect(roots.map((r) => r.id)).toEqual(["p", "self"]);
    expect(findNode(roots, "dangling")!.wbsCode).toBe("1.1");
    expect(findNode(roots, "q")!.wbsCode).toBe("1.2");
    expect(findNode(roots, "q")!.children).toEqual([]);
    expect(findNode(roots, "self")!.children).toEqual([]);
  });

  it("returns an empty tree for no records", () => {
    expect(buildTree([])).toEqual({ roots: [], orphanIds: [] });
  });

  it("keeps extra fields of the input type", () => {
    type Row = ActivityRecord & { color: string };
    const rows: Row[] = [{ ...record({ id: "x" }), color: "blue" }];
    const { roots } = buildTree(rows);
    expect(roots[0]!.color).toBe("blue");
  });
});

describe("flattenTree", () => {
  const { roots } = buildTree(fixture());

  it("emits pre-order rows with depth, codes and child flags", () => {
    const rows = flattenTree(roots);
    expect(rows.map((r) => `${r.wbsCode} ${r.id}`)).toEqual([
      "1 A",
      "1.1 A1",
      "1.1.1 A1a",
      "1.1.2 A1b",
      "1.2 A2",
      "2 B",
      "3 C",
      "3.1 C1",
    ]);
    const a1b = rows.find((r) => r.id === "A1b")!;
    expect(a1b).toMatchObject({ depth: 2, level: 3, hasChildren: false, isLastChild: true, parentId: "A1" });
    expect(a1b.ancestorIsLast).toEqual([false, false]);
    const c1 = rows.find((r) => r.id === "C1")!;
    expect(c1.ancestorIsLast).toEqual([true]);
    expect(rows[0]).toMatchObject({ id: "A", parentId: null, depth: 0, hasChildren: true, isCollapsed: false });
  });

  it("hides children of collapsed nodes", () => {
    const rows = flattenTree(roots, new Set(["A1", "C", "B"]));
    expect(rows.map((r) => r.id)).toEqual(["A", "A1", "A2", "B", "C"]);
    expect(rows.find((r) => r.id === "A1")!.isCollapsed).toBe(true);
    // A leaf cannot be collapsed.
    expect(rows.find((r) => r.id === "B")!.isCollapsed).toBe(false);
  });
});

describe("traversal helpers", () => {
  const { roots } = buildTree(fixture());
  const a = findNode(roots, "A")!;

  it("findNode", () => {
    expect(findNode(roots, "C1")!.id).toBe("C1");
    expect(findNode(roots, "nope")).toBeNull();
  });

  it("ancestorsOf returns root-first path", () => {
    expect(ancestorsOf(roots, "A1b").map((n) => n.id)).toEqual(["A", "A1"]);
    expect(ancestorsOf(roots, "A")).toEqual([]);
    expect(ancestorsOf(roots, "nope")).toEqual([]);
  });

  it("descendantsOf and leavesOf", () => {
    expect(descendantsOf(a).map((n) => n.id)).toEqual(["A1", "A1a", "A1b", "A2"]);
    expect(descendantsOf(findNode(roots, "B")!)).toEqual([]);
    expect(leavesOf(a).map((n) => n.id)).toEqual(["A1a", "A1b", "A2"]);
    expect(leavesOf(findNode(roots, "B")!).map((n) => n.id)).toEqual(["B"]);
  });

  it("subtreeHeight and depthOf", () => {
    expect(subtreeHeight(a)).toBe(3);
    expect(subtreeHeight(findNode(roots, "C")!)).toBe(2);
    expect(subtreeHeight(findNode(roots, "B")!)).toBe(1);
    expect(depthOf(roots, "A")).toBe(1);
    expect(depthOf(roots, "A1a")).toBe(3);
    expect(depthOf(roots, "nope")).toBeNull();
  });
});

describe("canMove (D22)", () => {
  const { roots } = buildTree(fixture());

  it("allows valid moves", () => {
    expect(canMove(roots, "A2", "B")).toEqual({ ok: true }); // leaf under a level-1 node
    expect(canMove(roots, "C", "B")).toEqual({ ok: true }); // height 2 under level 1 → depth 3
    expect(canMove(roots, "A1", null)).toEqual({ ok: true }); // promote to deliverable
    expect(canMove(roots, "A1a", "A2")).toEqual({ ok: true }); // leaf under level 2 → depth 3
    expect(canMove(roots, "A1", "A")).toEqual({ ok: true }); // same parent (reorder)
  });

  it("rejects moving into itself", () => {
    expect(canMove(roots, "A", "A")).toEqual({ ok: false, reason: "SELF" });
  });

  it("rejects moving under a descendant", () => {
    expect(canMove(roots, "A", "A1")).toEqual({ ok: false, reason: "DESCENDANT" });
    expect(canMove(roots, "A", "A1b")).toEqual({ ok: false, reason: "DESCENDANT" });
  });

  it("rejects moves that exceed three levels", () => {
    expect(canMove(roots, "A", "B")).toEqual({ ok: false, reason: "MAX_DEPTH" }); // height 3 under level 1
    expect(canMove(roots, "C", "A1")).toEqual({ ok: false, reason: "MAX_DEPTH" }); // height 2 under level 2
    expect(canMove(roots, "B", "A1a")).toEqual({ ok: false, reason: "MAX_DEPTH" }); // leaf under level 3
  });

  it("rejects unknown ids", () => {
    expect(canMove(roots, "nope", null)).toEqual({ ok: false, reason: "NOT_FOUND" });
    expect(canMove(roots, "A2", "nope")).toEqual({ ok: false, reason: "NOT_FOUND" });
  });

  it("flags over-deep data even when moving to the top", () => {
    const deep: ActivityNode = {
      ...record({ id: "d1" }),
      level: 1,
      wbsCode: "1",
      children: [
        {
          ...record({ id: "d2" }),
          level: 2,
          wbsCode: "1.1",
          children: [
            {
              ...record({ id: "d3" }),
              level: 3,
              wbsCode: "1.1.1",
              children: [{ ...record({ id: "d4" }), level: 4, wbsCode: "1.1.1.1", children: [] }],
            },
          ],
        },
      ],
    };
    expect(canMove([deep], "d1", null)).toEqual({ ok: false, reason: "MAX_DEPTH" });
  });

  it("has a plain-language message for every reason", () => {
    expect(canMoveMessage("SELF")).toMatch(/inside itself/);
    expect(canMoveMessage("DESCENDANT")).toMatch(/own sub-items/);
    expect(canMoveMessage("MAX_DEPTH")).toMatch(/at most 3 levels/);
    expect(canMoveMessage("NOT_FOUND")).toMatch(/Reload/);
  });
});

describe("delete impact", () => {
  function deliverable(subs: number, wpsPerSub: number[]): ActivityNode {
    const records: ActivityRecord[] = [record({ id: "D" })];
    for (let s = 0; s < subs; s += 1) {
      records.push(record({ id: `S${s}`, parentId: "D" }));
      for (let w = 0; w < (wpsPerSub[s] ?? 0); w += 1) records.push(record({ id: `S${s}W${w}`, parentId: `S${s}` }));
    }
    return buildTree(records).roots[0]!;
  }

  it("counts by level", () => {
    expect(countDescendantsByLevel(deliverable(4, [3, 3, 3, 2]))).toEqual({
      subDeliverables: 4,
      workPackages: 11,
      total: 15,
    });
  });

  it("describes plural, singular and zero parts", () => {
    expect(describeDeleteImpact(deliverable(4, [3, 3, 3, 2]))).toBe("Deletes 4 sub-deliverables and 11 work packages");
    expect(describeDeleteImpact(deliverable(1, [1]))).toBe("Deletes 1 sub-deliverable and 1 work package");
    expect(describeDeleteImpact(deliverable(2, [0, 0]))).toBe("Deletes 2 sub-deliverables");
    expect(describeDeleteImpact(deliverable(0, []))).toBe("Deletes this deliverable");
  });

  it("describes a sub-deliverable and a work package", () => {
    const tree = deliverable(1, [3]);
    const sub = tree.children[0]!;
    expect(describeDeleteImpact(sub)).toBe("Deletes 3 work packages");
    expect(countDescendantsByLevel(sub)).toEqual({ subDeliverables: 0, workPackages: 3, total: 3 });
    expect(describeDeleteImpact(sub.children[0]!)).toBe("Deletes this work package");
    expect(describeDeleteImpact(deliverable(1, [0]).children[0]!)).toBe("Deletes this sub-deliverable");
  });

  it("counts deeper-than-allowed data in total only", () => {
    const node: ActivityNode = {
      ...record({ id: "x" }),
      level: 3,
      wbsCode: "1.1.1",
      children: [{ ...record({ id: "y" }), level: 4, wbsCode: "1.1.1.1", children: [] }],
    };
    expect(countDescendantsByLevel(node)).toEqual({ subDeliverables: 0, workPackages: 0, total: 1 });
  });
});

describe("level labels", () => {
  it("labels levels and clamps out-of-range values", () => {
    expect(levelLabel(1)).toBe("Deliverable");
    expect(levelLabel(2)).toBe("Sub-deliverable");
    expect(levelLabel(3)).toBe("Work package");
    expect(levelLabel(0)).toBe("Deliverable");
    expect(levelLabel(9)).toBe("Work package");
  });

  it("labels the child level, null at max depth", () => {
    expect(childLevelLabel(1)).toBe("Sub-deliverable");
    expect(childLevelLabel(2)).toBe("Work package");
    expect(childLevelLabel(3)).toBeNull();
  });
});
