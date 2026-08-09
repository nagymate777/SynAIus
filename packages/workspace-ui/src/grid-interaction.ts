import type { GridRect } from "@synaius/domain";

export interface GridMetrics {
  columns: number | null;
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
  const scaleX = element.offsetWidth > 0 ? bounds.width / element.offsetWidth : 1;
  const scaleY = element.offsetHeight > 0 ? bounds.height / element.offsetHeight : scaleX;
  return {
    columns,
    cellWidth: bounds.width / columns,
    cellHeight: (Number.isFinite(rowSize) && rowSize > 0 ? rowSize : 32) * scaleY,
    contentLeft: bounds.left + element.clientLeft * scaleX,
    contentTop: bounds.top + element.clientTop * scaleY,
    scrollLeft: element.scrollLeft * scaleX,
    scrollTop: element.scrollTop * scaleY,
  };
}

export function gridPointFromClient(metrics: GridMetrics, clientX: number, clientY: number): GridPoint {
  return {
    column: Math.floor((clientX - metrics.contentLeft + metrics.scrollLeft) / metrics.cellWidth),
    row: Math.floor((clientY - metrics.contentTop + metrics.scrollTop) / metrics.cellHeight),
  };
}

export function nearestGridPointFromClient(metrics: GridMetrics, clientX: number, clientY: number): GridPoint {
  return {
    column: Math.round((clientX - metrics.contentLeft + metrics.scrollLeft) / metrics.cellWidth),
    row: Math.round((clientY - metrics.contentTop + metrics.scrollTop) / metrics.cellHeight),
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

export function moveRect(rect: GridRect, delta: GridPoint, columns: number | null): GridRect {
  return {
    ...rect,
    column: columns === null
      ? rect.column + delta.column
      : clamp(rect.column + delta.column, 0, Math.max(0, columns - rect.width)),
    row: columns === null ? rect.row + delta.row : Math.max(0, rect.row + delta.row),
  };
}

export function resizeRectFromStart(rect: GridRect, delta: GridPoint, columns: number | null): GridRect {
  const right = rect.column + rect.width;
  const bottom = rect.row + rect.height;
  const column = clamp(rect.column + delta.column, columns === null ? Number.MIN_SAFE_INTEGER : 0, right - 1);
  const row = clamp(rect.row + delta.row, columns === null ? Number.MIN_SAFE_INTEGER : 0, bottom - 1);
  return {
    column,
    row,
    width: right - column,
    height: bottom - row,
  };
}

export function resizeRectFromEnd(rect: GridRect, delta: GridPoint, columns: number | null): GridRect {
  const right = columns === null
    ? Math.max(rect.column + 1, rect.column + rect.width + delta.column)
    : clamp(rect.column + rect.width + delta.column, rect.column + 1, columns);
  const bottom = Math.max(rect.row + 1, rect.row + rect.height + delta.row);
  return {
    ...rect,
    width: right - rect.column,
    height: bottom - rect.row,
  };
}

export function rectAtPoint(point: GridPoint, width: number, height: number, columns: number | null): GridRect {
  const normalizedWidth = columns === null ? Math.max(1, width) : clamp(width, 1, columns);
  return {
    column: columns === null ? point.column : clamp(point.column, 0, columns - normalizedWidth),
    row: columns === null ? point.row : Math.max(0, point.row),
    width: normalizedWidth,
    height: Math.max(1, height),
  };
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
