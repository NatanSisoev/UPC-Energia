import { create } from 'zustand';

export interface Toast {
  id: number;
  kind: 'ok' | 'error' | 'info';
  title: string;
  text?: string;
}

interface ToastState {
  items: Toast[];
  push: (t: Omit<Toast, 'id'>, ms?: number) => void;
  dismiss: (id: number) => void;
  dismissAll: () => void;
}

let seq = 0;

/** Top-right notifications: each can be closed, all at once too; they also fade out on their own. */
export const useToasts = create<ToastState>((set, get) => ({
  items: [],
  push: (t, ms = 7000) => {
    const id = ++seq;
    set((s) => ({ items: [...s.items, { ...t, id }].slice(-5) }));
    window.setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
  dismissAll: () => set({ items: [] }),
}));
