import { create } from 'zustand';

export type AlertStatus = 'idle' | 'sending' | 'sent' | 'dry-run' | 'failed';

/** State of the scripted 4-minute live simulation. */
interface LiveState {
  active: boolean;
  paused: boolean;
  /** real seconds since the start */
  t: number;
  caption: { kicker: string; text: string } | null;
  incident: { title: string; detail: string } | null;
  alert: AlertStatus;
  alertDetail: string;
  start: () => void;
  stop: () => void;
  togglePause: () => void;
  set: (p: Partial<LiveState>) => void;
}

export const useLive = create<LiveState>((set) => ({
  active: false,
  paused: false,
  t: 0,
  caption: null,
  incident: null,
  alert: 'idle',
  alertDetail: '',
  start: () => set({ active: true, paused: false, t: 0, caption: null, incident: null, alert: 'idle', alertDetail: '' }),
  stop: () => set({ active: false, incident: null }),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  set: (p) => set(p),
}));
