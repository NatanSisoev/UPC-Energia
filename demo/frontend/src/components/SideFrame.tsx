import { useRef, useState, type ReactNode } from 'react';

const KEY = 'cn.sideW2';
const DEFAULT = 340;
const MIN = 280;
const maxW = () => Math.max(MIN, Math.min(640, window.innerWidth * 0.45));

function stored(): number {
  try {
    const v = Number(localStorage.getItem(KEY));
    return v >= MIN ? Math.min(v, maxW()) : DEFAULT;
  } catch {
    return DEFAULT;
  }
}

/**
 * Right-hand sidebar container with a drag handle on its left edge: drag to make it wider / narrower,
 * double-click to reset. The width is remembered per browser.
 */
export default function SideFrame({ children }: { children: ReactNode }) {
  const [w, setW] = useState(stored);
  const drag = useRef<{ x: number; w: number } | null>(null);
  const [active, setActive] = useState(false);

  const save = (v: number) => {
    try {
      localStorage.setItem(KEY, String(Math.round(v)));
    } catch {
      /* storage blocked: width just isn't remembered */
    }
  };

  return (
    <div className="relative h-full shrink-0" style={{ width: w }}>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize · double-click to reset"
        className={`absolute inset-y-0 -left-1 z-30 w-2 cursor-col-resize transition-colors ${active ? 'bg-[var(--accent)]' : 'hover:bg-[var(--accent-soft)]'}`}
        onPointerDown={(e) => {
          e.preventDefault();
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          drag.current = { x: e.clientX, w };
          setActive(true);
        }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          setW(Math.min(maxW(), Math.max(MIN, drag.current.w + drag.current.x - e.clientX)));
        }}
        onPointerUp={() => {
          drag.current = null;
          setActive(false);
          save(w);
        }}
        onDoubleClick={() => {
          setW(DEFAULT);
          save(DEFAULT);
        }}
      />
      {children}
    </div>
  );
}
