import { create } from 'zustand';
import { SCENES } from './script';

/** Pitch/presenter state. `auto` advances on timers (3-minute film); `presenter` waits for the keyboard. */
interface PitchState {
  active: boolean;
  mode: 'auto' | 'presenter';
  idx: number;
  /** seconds spent in the current scene */
  elapsed: number;
  /** seconds since the pitch started (shown in presenter mode) */
  total: number;
  paused: boolean;
  start: (mode: 'auto' | 'presenter') => void;
  stop: () => void;
  goto: (i: number) => void;
  next: () => void;
  prev: () => void;
  togglePause: () => void;
  setMode: (m: 'auto' | 'presenter') => void;
  advance: (dt: number) => void;
}

export const usePitch = create<PitchState>((set, get) => ({
  active: false,
  mode: 'auto',
  idx: 0,
  elapsed: 0,
  total: 0,
  paused: false,
  start: (mode) => set({ active: true, mode, idx: 0, elapsed: 0, total: 0, paused: false }),
  stop: () => set({ active: false }),
  goto: (i) => set({ idx: Math.min(SCENES.length - 1, Math.max(0, i)), elapsed: 0 }),
  next: () => {
    const s = get();
    if (s.idx >= SCENES.length - 1) set({ active: false });
    else set({ idx: s.idx + 1, elapsed: 0 });
  },
  prev: () => set((s) => ({ idx: Math.max(0, s.idx - 1), elapsed: 0 })),
  togglePause: () => set((s) => ({ paused: !s.paused })),
  setMode: (mode) => set({ mode, elapsed: 0 }),
  advance: (dt) => {
    const s = get();
    if (!s.active || s.paused) return;
    const elapsed = s.elapsed + dt;
    const total = s.total + dt;
    if (s.mode === 'auto' && elapsed >= SCENES[s.idx].dur) {
      if (s.idx >= SCENES.length - 1) set({ active: false });
      else set({ idx: s.idx + 1, elapsed: 0, total });
    } else set({ elapsed, total });
  },
}));
