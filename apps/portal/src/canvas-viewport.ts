import type { LayoutId } from "@synaius/domain";
import type { GridMetrics } from "./grid-interaction";

export interface CanvasViewport {
  panX: number;
  panY: number;
  zoom: number;
}

export type CanvasViewportMap = Record<string, CanvasViewport>;

export const DEFAULT_CANVAS_VIEWPORT: CanvasViewport = { panX: 0, panY: 0, zoom: 1 };
export const CANVAS_VIEWPORT_STORAGE_KEY = "synaius.canvas-viewports.v1";
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;

export function canvasViewportKey(viewId: string, device: LayoutId) {
  return `${viewId}:${device}`;
}

export function loadCanvasViewports(): CanvasViewportMap {
  try {
    const raw = localStorage.getItem(CANVAS_VIEWPORT_STORAGE_KEY);
    if (raw === null) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, CanvasViewport] =>
      typeof entry[0] === "string" && isCanvasViewport(entry[1])));
  } catch {
    return {};
  }
}

export function saveCanvasViewports(viewports: CanvasViewportMap) {
  try {
    localStorage.setItem(CANVAS_VIEWPORT_STORAGE_KEY, JSON.stringify(viewports));
    return true;
  } catch {
    return false;
  }
}

export function zoomViewportAt(
  viewport: CanvasViewport,
  localX: number,
  localY: number,
  deltaY: number,
): CanvasViewport {
  const factor = deltaY < 0 ? 1.12 : 1 / 1.12;
  const zoom = clamp(viewport.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (zoom === viewport.zoom) return viewport;
  const worldX = (localX - viewport.panX) / viewport.zoom;
  const worldY = (localY - viewport.panY) / viewport.zoom;
  return {
    panX: localX - worldX * zoom,
    panY: localY - worldY * zoom,
    zoom,
  };
}

export function rootGridMetrics(
  canvas: HTMLElement,
  viewport: CanvasViewport,
  cellSize: number,
): GridMetrics {
  const bounds = canvas.getBoundingClientRect();
  return {
    columns: null,
    cellWidth: cellSize * viewport.zoom,
    cellHeight: cellSize * viewport.zoom,
    contentLeft: bounds.left + viewport.panX,
    contentTop: bounds.top + viewport.panY,
    scrollLeft: 0,
    scrollTop: 0,
  };
}

export function canvasCellSize(canvas: HTMLElement) {
  const value = Number.parseFloat(getComputedStyle(canvas).getPropertyValue("--cell-size"));
  return Number.isFinite(value) && value > 0 ? value : 32;
}

function isCanvasViewport(value: unknown): value is CanvasViewport {
  if (!isRecord(value)) return false;
  return typeof value.panX === "number" && Number.isFinite(value.panX)
    && typeof value.panY === "number" && Number.isFinite(value.panY)
    && typeof value.zoom === "number" && Number.isFinite(value.zoom)
    && value.zoom >= MIN_ZOOM && value.zoom <= MAX_ZOOM;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}
