import type { GridRect } from "@synaius/domain";

export interface GridMetrics {
  columns: number;
  cellWidth: number;
  cellHeight: number;
  contentLeft: number;
  contentTop: number;
  scrollLeft: number;
  scrollTop: number;
}

export interface GridPoint {
  column: number;
  row: number;
}

export function readGridMetrics(element: HTMLElement, columns: number): GridMetrics {
  const bounds = element.getBoundingClientRect();
  const rowSize = Number.parseFloat(getComputedStyle(element).gridAutoRows);
  return {
    columns,
    cellWidth: element.clientWidth / columns,
    cellHeight: Number.isFinite(rowSize) && rowSize > 0 ? rowSize : 32,
    contentLeft: bounds.left + element.clientLeft,
    contentTop: bounds.top + element.clientTop,
    scrollLeft: element.scrollLeft,
    scrollTop: element.scrollTop,
  };
}

export function gridPointFromClient(metrics: GridMetrics, clientX: number, clientY: number): GridPoint {
  return {
    column: Math.floor((clientX - metrics.contentLeft + metrics.scrollLeft) / metrics.cellWidth),
    row: Math.floor((clientY - metrics.contentTop + metrics.scrollTop) / metrics.cellHeight),
  };
}

export function gridDeltaFromClient(
  metrics: GridMetrics,
  startClientX: number,
  startClientY: number,
  clientX: number,
  clientY: number,
): GridPoint {
  return {
    column: Math.round((clientX - startClientX) / metrics.cellWidth),
    row: Math.round((clientY - startClientY) / metrics.cellHeight),
  };
}

export function moveRect(rect: GridRect, delta: GridPoint, columns: number): GridRect {
  return {
    ...rect,
    column: clamp(rect.column + delta.column, 0, Math.max(0, columns - rect.width)),
    row: Math.max(0, rect.row + delta.row),
  };
}

export function resizeRectFromStart(rect: GridRect, delta: GridPoint, columns: number): GridRect {
  const right = rect.column + rect.width;
  const bottom = rect.row + rect.height;
  const column = clamp(rect.column + delta.column, 0, right - 1);
  const row = clamp(rect.row + delta.row, 0, bottom - 1);
  return {
    column,
    row,
    width: right - column,
    height: bottom - row,
  };
}

export function resizeRectFromEnd(rect: GridRect, delta: GridPoint, columns: number): GridRect {
  const right = clamp(rect.column + rect.width + delta.column, rect.column + 1, columns);
  const bottom = Math.max(rect.row + 1, rect.row + rect.height + delta.row);
  return {
    ...rect,
    width: right - rect.column,
    height: bottom - rect.row,
  };
}

export function rectAtPoint(point: GridPoint, width: number, height: number, columns: number): GridRect {
  const normalizedWidth = clamp(width, 1, columns);
  return {
    column: clamp(point.column, 0, columns - normalizedWidth),
    row: Math.max(0, point.row),
    width: normalizedWidth,
    height: Math.max(1, height),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
