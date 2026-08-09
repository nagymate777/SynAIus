import { describe, expect, it } from "vitest";
import {
  gridDeltaFromClient,
  gridPointFromClient,
  moveRect,
  nearestGridPointFromClient,
  rectAtPoint,
  resizeRectFromEnd,
  resizeRectFromStart,
  type GridMetrics,
} from "@synaius/workspace-ui";

const metrics: GridMetrics = {
  columns: 12,
  cellWidth: 50,
  cellHeight: 25,
  contentLeft: 100,
  contentTop: 50,
  scrollLeft: 0,
  scrollTop: 0,
};

describe("grid interaction geometry", () => {
  it("maps client coordinates and deltas to grid coordinates", () => {
    expect(gridPointFromClient(metrics, 225, 112)).toEqual({ column: 2, row: 2 });
    expect(gridDeltaFromClient(metrics, 100, 50, 174, 88)).toEqual({ column: 1, row: 2 });
    expect(nearestGridPointFromClient(metrics, 225, 112)).toEqual({ column: 3, row: 2 });
  });

  it("moves a box without allowing it beyond the grid or above row zero", () => {
    expect(moveRect({ column: 8, row: 2, width: 3, height: 2 }, { column: 5, row: -5 }, 12))
      .toEqual({ column: 9, row: 0, width: 3, height: 2 });
  });

  it("resizes from both corners while preserving a one-cell minimum", () => {
    const rect = { column: 2, row: 2, width: 4, height: 4 };
    expect(resizeRectFromStart(rect, { column: 2, row: -3 }, 12))
      .toEqual({ column: 4, row: 0, width: 2, height: 6 });
    expect(resizeRectFromEnd(rect, { column: -8, row: -8 }, 12))
      .toEqual({ column: 2, row: 2, width: 1, height: 1 });
  });

  it("places a box at a point and clamps its width to the target grid", () => {
    expect(rectAtPoint({ column: 11, row: -2 }, 4, 3, 12))
      .toEqual({ column: 8, row: 0, width: 4, height: 3 });
  });

  it("allows negative coordinates on the unbounded root workspace", () => {
    expect(moveRect({ column: 1, row: 2, width: 3, height: 2 }, { column: -5, row: -7 }, null))
      .toEqual({ column: -4, row: -5, width: 3, height: 2 });
    expect(rectAtPoint({ column: -8, row: -3 }, 4, 3, null))
      .toEqual({ column: -8, row: -3, width: 4, height: 3 });
  });
});
