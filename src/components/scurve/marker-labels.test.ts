import { describe, expect, it } from "vitest";
import { layoutMarkerLabels } from "./scurve-chart";

describe("layoutMarkerLabels", () => {
  it("puts Today right of its line and Planned end left of its line when apart", () => {
    expect(layoutMarkerLabels(100, 400, 600)).toEqual({ todayX: 104, endX: 336, endY: 10 });
  });

  it("flips Today left near the right edge so it never reaches the value axis", () => {
    const { todayX } = layoutMarkerLabels(590, null, 600);
    expect(todayX).toBe(556);
    expect((todayX ?? 0) + 30).toBeLessThanOrEqual(600);
  });

  it("keeps Planned end inside the plot near the left edge", () => {
    expect(layoutMarkerLabels(null, 20, 600).endX).toBe(24);
  });

  it("drops Planned end to a second line when the labels would touch", () => {
    expect(layoutMarkerLabels(300, 320, 600).endY).toBe(26);
    expect(layoutMarkerLabels(560, 590, 600).endY).toBe(26);
    expect(layoutMarkerLabels(null, 320, 600).endY).toBe(10);
  });
});
