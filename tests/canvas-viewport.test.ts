import { describe, expect, it } from "vitest";
import { zoomViewportAt } from "@synaius/workspace-ui";

describe("canvas viewport", () => {
  it("keeps the world point under the pointer stable while zooming", () => {
    const before = { panX: 20, panY: -10, zoom: 1 };
    const pointer = { x: 220, y: 140 };
    const worldBefore = {
      x: (pointer.x - before.panX) / before.zoom,
      y: (pointer.y - before.panY) / before.zoom,
    };
    const after = zoomViewportAt(before, pointer.x, pointer.y, -100);
    expect((pointer.x - after.panX) / after.zoom).toBeCloseTo(worldBefore.x);
    expect((pointer.y - after.panY) / after.zoom).toBeCloseTo(worldBefore.y);
    expect(after.zoom).toBeGreaterThan(before.zoom);
  });

  it("enforces safe practical zoom limits", () => {
    let viewport = { panX: 0, panY: 0, zoom: 1 };
    for (let index = 0; index < 100; index += 1) viewport = zoomViewportAt(viewport, 0, 0, 100);
    expect(viewport.zoom).toBe(0.2);
    for (let index = 0; index < 200; index += 1) viewport = zoomViewportAt(viewport, 0, 0, -100);
    expect(viewport.zoom).toBe(4);
  });
});
