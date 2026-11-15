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
  /** the audience / jury touched something outside the tour: covers are hidden, the tour keeps running in the corner */
  diverged: boolean;
  /** put the app back on the current beat (reset + replay), i.e. back to the tour's normal order */
  resume: () => void;
  /** reset everything and go to beat 1 */
  restart: () => void;
  diverge: () => void;
  start: () => void;
  stop: () => void;
  toggle: () => void;
  next: () => void;
  prev: () => void;
  /** jump to beat `i` (0-based); `sub` = micro-clicks already done (default 0) */
  goto: (i: number, sub?: number) => void;
  toggleNotes: () => void;
}

let token = 0;

export const useTour = create<TourState>((set, get) => {
  /** put the app into position (i, sub); the last item is animated, the replayed ones are instant */
  async function land(i: number, sub: number, smooth = false): Promise<void> {
    const my = ++token;
    set({ idx: i, sub, busy: true, diverged: false });
    await resetBase(smooth);
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
    diverged: false,
    diverge: () => {
      if (get().active && !get().diverged) set({ diverged: true });
    },
    resume: () => void land(get().idx, get().sub),
    restart: () => void land(0, 0),
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
    toggle: () => (get().active ? get().stop() : get().start()),
    next: () => {
      const { idx, sub, diverged } = get();
      const clicks = STEPS[idx].clicks ?? [];
      // after free exploration the screen no longer matches the beat: re-land cleanly on the next position
      if (diverged) {
        if (sub < clicks.length) void land(idx, sub + 1);
        else if (idx < STEPS.length - 1) void land(idx + 1, 0);
        return;
      }
      if (sub < clicks.length) {
        const my = ++token;
        set({ sub: sub + 1 });
        void Promise.resolve(clicks[sub].run({ animate: true })).then(() => my === token && set({ busy: false }));
      } else if (idx < STEPS.length - 1) void land(idx + 1, 0, true);
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
