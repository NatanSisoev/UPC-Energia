import { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router';
import { camera } from '../components/MapView';
import { useInsightsUi } from '../components/Insights';
import { derived, useSim } from '../store/useSim';
import { PITCH_WEEK, SCENES, TOTAL_SECONDS, type Facts } from './script';
import { usePitch } from './usePitch';

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

/** Facts for the captions, read from the replay data and the live challenge.ts simulation. */
function useFacts(): Facts | null {
  const replay = useSim((s) => s.replay);
  const campus = useSim((s) => s.campus);
  const version = useSim((s) => s.version);
  return useMemo(() => {
    void version;
    const d = derived.current;
    if (!replay || !campus || !d) return null;
    let sum = 0;
    let n = 0;
    for (const w of replay) for (const v of w.load) (sum += v), n++;
    const m = d.summary.mpc;
    return {
      buildings: campus.features.length,
      meanLoadMw: sum / n / 1000,
      weeks: replay.length,
      meanMpc: replay.reduce((a, w) => a + w.mpc.score, 0) / replay.length,
      meanTemplate: replay.reduce((a, w) => a + w.template.score, 0) / replay.length,
      violations: replay.reduce((a, w) => a + w.mpc.viol, 0),
      weekStart: d.week.start.slice(0, 10),
      scoreMpc: m.score,
      scoreTemplate: d.summary.template.score,
      dCo2Mpc: m.dCo2Pct,
      dCostMpc: m.dCostPct,
      co2SavedKg: m.co2SavedKg,
      costSavedEur: m.costSavedEur,
    };
  }, [replay, campus, version]);
}

/** Runs the scripted tour: applies each scene to the app, advances the clock, handles the keyboard. */
export function PitchRunner() {
  const navigate = useNavigate();
  const active = usePitch((s) => s.active);
  const idx = usePitch((s) => s.idx);
  const ready = useSim((s) => s.snap !== null);

  // heartbeat
  useEffect(() => {
    if (!active) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const n = performance.now();
      usePitch.getState().advance(Math.min(0.5, (n - last) / 1000));
      last = n;
    }, 100);
    return () => window.clearInterval(id);
  }, [active]);

  // apply the scene
  useEffect(() => {
    if (!active || !ready) return;
    const sc = SCENES[idx];
    const st = useSim.getState();
    if (idx === 0 && st.weekIdx !== PITCH_WEEK) st.setWeek(PITCH_WEEK);
    if (sc.agent && st.agent !== sc.agent) st.setAgent(sc.agent);
    if (sc.layers) st.setLayers(sc.layers);
    if (sc.xray !== undefined) st.setUnderground(sc.xray);
    if (sc.sunLock !== undefined) st.setSunLock(sc.sunLock);
    if (sc.tMin !== undefined) st.setTMin(sc.tMin);
    if (sc.speed !== undefined) {
      st.setSpeed(sc.speed || 60);
      st.setPlaying(sc.speed > 0);
    }
    if (sc.insight) useInsightsUi.getState().setTab(sc.insight);
    if (window.location.pathname !== (sc.route === '/' ? '/' : sc.route)) navigate(sc.route);
    if (sc.cam) {
      camera.go(sc.cam.from, 0, 'linear');
      if (sc.cam.to) {
        const to = sc.cam.to;
        const ms = usePitch.getState().mode === 'auto' ? sc.dur * 1000 : 24000;
        const t = window.setTimeout(() => camera.go(to, ms, 'linear'), 60);
        return () => window.clearTimeout(t);
      }
    }
  }, [active, idx, ready, navigate]);

  // keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const p = usePitch.getState();
      if (!p.active) {
        if (e.key === 'p' || e.key === 'P') p.start('auto');
        else if (e.key === 'm' || e.key === 'M') p.start('presenter');
        return;
      }
      switch (e.key) {
        case 'Escape':
          p.stop();
          break;
        case 'ArrowRight':
        case 'PageDown':
        case 'Enter':
        case 'n':
          p.next();
          break;
        case ' ':
          e.preventDefault();
          if (p.mode === 'presenter') p.next();
          else p.togglePause();
          break;
        case 'ArrowLeft':
        case 'PageUp':
        case 'b':
          p.prev();
          break;
        case 'Home':
          p.goto(0);
          break;
        case 'End':
          p.goto(SCENES.length - 1);
          break;
        case 'a':
        case 'A':
          p.setMode(p.mode === 'auto' ? 'presenter' : 'auto');
          break;
        default:
          if (/^[0-9]$/.test(e.key)) p.goto(e.key === '0' ? 9 : Number(e.key) - 1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return null;
}

/** Cinematic caption card + progress rail. */
export function PitchCaption() {
  const { idx, elapsed, total, mode, paused } = usePitch();
  const facts = useFacts();
  const sc = SCENES[idx];
  if (!facts) return null;
  const txt = (t: string | ((f: Facts) => string)) => (typeof t === 'function' ? t(facts) : t);
  const pct = mode === 'auto' ? Math.min(1, elapsed / sc.dur) : 0;

  return (
    <div className="pointer-events-auto panel flex w-[min(640px,50%)] shrink-0 flex-col gap-1.5 !rounded-[20px] px-4 py-3">
      <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-[0.14em] text-lime-300">
        <span>{sc.kicker}</span>
        <span className="tnum text-slate-400">
          {mode === 'auto' ? `${mmss(total)} / ${mmss(TOTAL_SECONDS)}${paused ? ' · paused' : ''}` : `presenter · ${mmss(total)}`}
        </span>
      </div>
      <div className="font-display text-[19px] leading-tight text-white">{txt(sc.title)}</div>
      <p className="text-[12.5px] font-semibold leading-snug text-slate-200">{txt(sc.body)}</p>
      {mode === 'presenter' && sc.notes && <p className="border-t border-white/10 pt-1.5 text-[10.5px] font-semibold italic leading-snug text-amber-200/90">🎤 {sc.notes}</p>}
      <div className="mt-1 flex items-center gap-1">
        {SCENES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            title={`${i + 1}. ${s.id}`}
            onClick={() => usePitch.getState().goto(i)}
            className="relative h-2 flex-1 overflow-hidden rounded-full bg-[#131b3a]"
          >
            <span className="absolute inset-y-0 left-0 rounded-full bg-lime-300" style={{ width: i < idx ? '100%' : i === idx ? `${Math.max(pct, mode === 'presenter' ? 1 : 0) * 100}%` : '0%' }} />
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between text-[10px] font-extrabold text-slate-500">
        <span>{mode === 'auto' ? 'Space pause · ←/→ scenes · A presenter · Esc exit' : '←/→ or Space: next · A auto-play · Esc exit'}</span>
        <button type="button" className="text-slate-300 hover:text-white" onClick={() => usePitch.getState().stop()}>
          ✕ exit
        </button>
      </div>
    </div>
  );
}
