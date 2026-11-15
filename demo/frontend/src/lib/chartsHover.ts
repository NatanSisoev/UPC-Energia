import { useSim } from '../store/useSim';

/** expand button on the timeline: opens / closes the charts panel docked under the strip (no hover behaviour) */
export function toggleCharts() {
  const s = useSim.getState();
  const open = s.chartsPinned || s.chartsOpen;
  useSim.setState({ chartsPinned: !open, chartsOpen: !open });
}

/** Esc: closes the panel; returns true if something was closed */
export function closeCharts(): boolean {
  const s = useSim.getState();
  if (!s.chartsPinned && !s.chartsOpen) return false;
  useSim.setState({ chartsPinned: false, chartsOpen: false });
  return true;
}
