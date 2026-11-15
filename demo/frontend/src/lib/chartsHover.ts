import { useSim } from '../store/useSim';

/** how long the pointer must rest on the timeline strip before the charts panel opens */
export const DWELL_OPEN_MS = 1200;
/** how long the pointer must be away from both the strip and the panel before it closes */
export const LEAVE_CLOSE_MS = 600;
/** movement (px) from where the dwell started that counts as "moving through", restarting the dwell */
const DWELL_MOVE_PX = 40;
/** enter events right after a layout change are ignored (the strip moves under a resting pointer) */
const SETTLE_MS = 500;

let dwellT: number | undefined;
let closeT: number | undefined;
let anchor: { x: number; y: number } | null = null;
let overStrip = false;
let overPanel = false;
let dragging = false;
let settleUntil = 0;
/** after a close, the dwell only re-arms once the pointer has left the strip */
let armed = true;

const set = (p: Partial<ReturnType<typeof useSim.getState>>) => useSim.setState(p);
const clearDwell = () => {
  window.clearTimeout(dwellT);
  dwellT = undefined;
  if (useSim.getState().chartsDwell) set({ chartsDwell: false });
};
const clearClose = () => {
  window.clearTimeout(closeT);
  closeT = undefined;
};

function startDwell(x: number, y: number) {
  clearDwell();
  const s = useSim.getState();
  if (!armed || dragging || s.chartsOpen || s.chartsPinned || performance.now() < settleUntil) return;
  anchor = { x, y };
  set({ chartsDwell: true });
  dwellT = window.setTimeout(() => {
    dwellT = undefined;
    armed = false;
    settleUntil = performance.now() + SETTLE_MS;
    set({ chartsDwell: false, chartsOpen: true });
  }, DWELL_OPEN_MS);
}

function maybeClose() {
  clearClose();
  if (overStrip || overPanel || useSim.getState().chartsPinned || !useSim.getState().chartsOpen) return;
  closeT = window.setTimeout(() => {
    closeT = undefined;
    if (overStrip || overPanel) return;
    settleUntil = performance.now() + SETTLE_MS;
    set({ chartsOpen: false });
  }, LEAVE_CLOSE_MS);
}

export const stripHover = {
  enter(e: { clientX: number; clientY: number }) {
    overStrip = true;
    clearClose();
    startDwell(e.clientX, e.clientY);
  },
  move(e: { clientX: number; clientY: number }) {
    if (!anchor || dwellT === undefined) return;
    if (Math.hypot(e.clientX - anchor.x, e.clientY - anchor.y) > DWELL_MOVE_PX) startDwell(e.clientX, e.clientY);
  },
  leave() {
    overStrip = false;
    armed = true;
    clearDwell();
    maybeClose();
  },
  down() {
    dragging = true;
    clearDwell();
    const up = () => {
      dragging = false;
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  },
};

export const panelHover = {
  enter() {
    overPanel = true;
    clearClose();
  },
  leave() {
    overPanel = false;
    maybeClose();
  },
};

/** pin button: pinned keeps the panel open regardless of hover; unpinning closes it */
export function togglePin() {
  const s = useSim.getState();
  clearDwell();
  clearClose();
  settleUntil = performance.now() + SETTLE_MS;
  armed = false;
  if (s.chartsPinned) set({ chartsPinned: false, chartsOpen: false });
  else set({ chartsPinned: true, chartsOpen: true });
}

/** Esc: closes the panel (pinned or not); returns true if something was closed */
export function closeCharts(): boolean {
  const s = useSim.getState();
  if (!s.chartsPinned && !s.chartsOpen) return false;
  clearDwell();
  clearClose();
  armed = false;
  settleUntil = performance.now() + SETTLE_MS;
  set({ chartsPinned: false, chartsOpen: false });
  return true;
}
