export type VisibleViewport = { height: number; offsetTop: number; scale: number };

// Keep the sheet inside the visible area, but leave the scrim covering the full page.
// A zoomed viewport is not evidence that the software keyboard is open.
export function modalViewport(layoutHeight: number, viewport?: VisibleViewport | null) {
  const layout = Math.max(1, layoutHeight);
  const top = Math.min(Math.max(0, viewport?.offsetTop || 0), layout - 1);
  const height = Math.max(1, Math.min(viewport?.height || layout, layout - top));
  return { top, height, keyboardOpen: !!viewport && Math.abs(viewport.scale - 1) < 0.05 && layout - viewport.height > 120 };
}
