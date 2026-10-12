export type VisibleViewport = { height: number; offsetTop: number; scale: number };

// Keep the sheet inside the visible area, but leave the scrim covering the full page.
// A zoomed viewport is not evidence that the software keyboard is open.
export function modalViewport(layoutHeight: number, viewport?: VisibleViewport | null) {
  const layout = Math.max(1, layoutHeight);
  const top = Math.min(Math.max(0, viewport?.offsetTop || 0), layout - 1);
  const height = Math.max(1, Math.min(viewport?.height || layout, layout - top));
  return { top, height, keyboardOpen: !!viewport && Math.abs(viewport.scale - 1) < 0.05 && layout - viewport.height > 120 };
}

// Only the form scrolls. Keep its input label visible above the focused field.
export function inputScrollTop(current: number, fieldTop: number, fieldBottom: number, areaTop: number, areaBottom: number) {
  const labelSpace = Math.min(32, Math.max(0, areaBottom - areaTop - (fieldBottom - fieldTop) - 12));
  if (fieldTop < areaTop + labelSpace) return Math.max(0, current + fieldTop - areaTop - labelSpace);
  if (fieldBottom > areaBottom - 12) return Math.max(0, current + fieldBottom - areaBottom + 12);
  return current;
}

export function isInputEnter(event: Pick<KeyboardEvent, 'key' | 'isComposing' | 'keyCode'>) {
  return event.key === 'Enter' && !event.isComposing && event.keyCode !== 229;
}
