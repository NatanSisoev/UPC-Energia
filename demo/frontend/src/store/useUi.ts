import { create } from 'zustand';
import { useEffect } from 'react';
import type { SettingsTab } from '../components/Settings';

export type Side = 'chat' | 'alarms' | 'building' | 'fault' | null;
export type Popup = 'scenario' | 'model' | 'calendar';

/**
 * Tiny request bus so code outside a component (the guided Tour) can drive UI that lives in local React state:
 * the sidebar, the Settings dialog, the assistant question and the header drop-downs. Every request carries a counter
 * `n`, so asking for the same thing twice still fires; consumers apply the value (absolute, never a toggle).
 */
interface UiBus {
  sideReq: { side: Side; n: number } | null;
  settingsReq: { tab: SettingsTab | null; n: number } | null;
  askReq: { q: string; n: number } | null;
  popupReq: Partial<Record<Popup, { open: boolean; n: number }>>;
  zoomReq: { zoom: 'week' | 'day'; n: number } | null;
  setZoom: (zoom: 'week' | 'day') => void;
  setSide: (side: Side) => void;
  setSettings: (tab: SettingsTab | null) => void;
  ask: (q: string) => void;
  setPopup: (p: Popup, open: boolean) => void;
}

export const useUi = create<UiBus>((set, get) => ({
  sideReq: null,
  settingsReq: null,
  askReq: null,
  popupReq: {},
  zoomReq: null,
  setZoom: (zoom) => set({ zoomReq: { zoom, n: (get().zoomReq?.n ?? 0) + 1 } }),
  setSide: (side) => set({ sideReq: { side, n: (get().sideReq?.n ?? 0) + 1 } }),
  setSettings: (tab) => set({ settingsReq: { tab, n: (get().settingsReq?.n ?? 0) + 1 } }),
  ask: (q) => set({ askReq: { q, n: (get().askReq?.n ?? 0) + 1 } }),
  setPopup: (p, open) => set({ popupReq: { ...get().popupReq, [p]: { open, n: (get().popupReq[p]?.n ?? 0) + 1 } } }),
}));

/** header drop-downs: follow `useUi.setPopup(name, open)` */
export function usePopupReq(name: Popup, setOpen: (v: boolean) => void): void {
  const req = useUi((s) => s.popupReq[name]);
  useEffect(() => {
    if (req) setOpen(req.open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req?.n]);
}
