import { create } from 'zustand';
import { useSim } from '../store/useSim';
import { STEPS } from './steps';
import { resetBase, restore, snapshotPrefs } from './actions';

/**
 * Tour state. A position is (idx = beat, sub = micro-clicks already run). Next / Back / jump all land on a position by
 * `resetBase()` + `enter()` + the first `sub` clicks, so the screen never depends on how you got there; only plain
 * "Next" skips the reset for a micro-click (it just runs that click on top of the current state, animated).
 */
interface TourState {
  active: boolean;
  idx: number;
  sub: number;
  notesOpen: boolean;
  busy: boolean;
  start: () => void;
  stop: () => void;
  next: () => void;
  prev: () => void;
  /** jump to beat `i` (0-based); `sub` = micro-clicks already done (default 0) */
  goto: (i: number, sub?: number) => void;
  toggleNotes: () => void;
}

let token = 0;

export const useTour = create<TourState>((set, get) => {
  /** put the app into position (i, sub); the last item is animated, the replayed ones are instant */
  async function land(i: number, sub: number): Promise<void> {
    const my = ++token;
    set({ idx: i, sub, busy: true });
    await resetBase();
    if (my !== token) return;
    const step = STEPS[i];
    const tasks = [step.enter, ...(step.clicks ?? []).slice(0, sub).map((k) => k.run)];
    for (let t = 0; t < tasks.length; t++) {
      await tasks[t]({ animate: t === tasks.length - 1 });
      if (my !== token) return;
    }
    set({ busy: false });
  }

  return {
    active: false,
    idx: 0,
    sub: 0,
    notesOpen: false,
    busy: false,
    start: () => {
      if (get().active || !useSim.getState().snap) return;
      snapshotPrefs();
      set({ active: true });
      void land(0, 0);
    },
    stop: () => {
      token++;
      set({ active: false, busy: false });
      void restore();
    },
    next: () => {
      const { idx, sub } = get();
      const clicks = STEPS[idx].clicks ?? [];
      if (sub < clicks.length) {
        const my = ++token;
        set({ sub: sub + 1 });
        void Promise.resolve(clicks[sub].run({ animate: true })).then(() => my === token && set({ busy: false }));
      } else if (idx < STEPS.length - 1) void land(idx + 1, 0);
      else get().stop();
    },
    prev: () => {
      const { idx, sub } = get();
      if (sub > 0) void land(idx, sub - 1);
      else if (idx > 0) void land(idx - 1, (STEPS[idx - 1].clicks ?? []).length);
    },
    goto: (i, sub = 0) => void land(Math.min(STEPS.length - 1, Math.max(0, i)), sub),
    toggleNotes: () => set((s) => ({ notesOpen: !s.notesOpen })),
  };
});
