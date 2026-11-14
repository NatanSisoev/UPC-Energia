/**
 * The campus assistant: a small, deterministic question answerer over the replayed data.
 * No LLM and no network: every answer is computed from `derived` (the challenge-exact simulation of the
 * current week) and the 35 replay weeks, so the numbers always match the map and the leaderboard metric.
 * Understands short questions in English, Spanish and Catalan (keyword intents + a day/hour parser).
 */
import { derived, useSim } from '../store/useSim';
import { fmtKw } from './format';

const DOW_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = (n: number) => String(n).padStart(2, '0');
const DAY = 86_400_000;

export interface Answer {
  text: string;
  /** optional: move the timeline to this sim-minute of the week */
  goTo?: number;
}

export interface Suggestion {
  kind: 'charge' | 'discharge' | 'hold' | 'none';
  title: string;
  kw: number;
  why: string;
  next: string | null;
  soc: number;
  capacityKwh: number;
}

/* ------------------------------------------------------------ helpers ---- */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[·']/g, ' ');

const has = (q: string, ...words: string[]) => words.some((w) => new RegExp(`(^|[^a-z])${w}`).test(q));

function ctx() {
  const d = derived.current;
  const s = useSim.getState();
  if (!d || !s.snap || !s.campus) return null;
  return { d, s, snap: s.snap, h: s.snap.hour, n: d.week.load.length };
}

/** "Tue 14 Apr 13:00" for hour index h of the current week. */
export function hourLabel(h: number): string {
  const d = derived.current;
  if (!d) return '';
  const t = new Date(d.week.ms[Math.max(0, Math.min(d.week.ms.length - 1, h))]);
  return `${DOW_EN[t.getUTCDay()].slice(0, 3)} ${t.getUTCDate()} ${MON[t.getUTCMonth()]} ${p2(t.getUTCHours())}:00`;
}
const clock = (h: number) => {
  const d = derived.current!;
  return `${p2(new Date(d.week.ms[h]).getUTCHours())}:00`;
};
const dayKey = (h: number) => Math.floor(derived.current!.week.ms[h] / DAY);

/** Hour indices of the calendar day containing h (within the replayed week). */
function dayHours(h: number): number[] {
  const d = derived.current!;
  const k = dayKey(h);
  const out: number[] = [];
  for (let i = 0; i < d.week.ms.length; i++) if (Math.floor(d.week.ms[i] / DAY) === k) out.push(i);
  return out;
}

const argmin = (idx: number[], v: ArrayLike<number>) => idx.reduce((a, b) => (v[b] < v[a] ? b : a), idx[0]);
const argmax = (idx: number[], v: ArrayLike<number>) => idx.reduce((a, b) => (v[b] > v[a] ? b : a), idx[0]);
const mean = (idx: number[], v: ArrayLike<number>) => idx.reduce((a, b) => a + v[b], 0) / Math.max(1, idx.length);
const sum = (idx: number[], v: ArrayLike<number>) => idx.reduce((a, b) => a + v[b], 0);
const next24 = (h: number, n: number) => Array.from({ length: Math.min(24, n - h) }, (_, i) => h + i);
const pct = (v: number) => `${v >= 0 ? '+' : '−'}${Math.abs(v * 100).toFixed(0)}%`;
const mwh = (kwh: number) => (kwh >= 1000 ? `${(kwh / 1000).toFixed(1)} MWh` : `${kwh.toFixed(0)} kWh`);

/* ---------------------------------------------------- suggested action ---- */

export function suggestion(): Suggestion | null {
  const c = ctx();
  if (!c) return null;
  const { d, snap, h, n } = c;
  const sp = d.chosen.sp;
  const cls = (v: number) => (v > 5 ? 'charge' : v < -5 ? 'discharge' : 'hold');
  const now = cls(sp[h]);
  const r = d.chosen.reasons[h];
  let next: string | null = null;
  for (let i = h + 1; i < n; i++) {
    const k = cls(sp[i]);
    if (k !== now) {
      next = `${k === 'charge' ? 'Charge' : k === 'discharge' ? 'Discharge' : 'Hold'} from ${hourLabel(i)}`;
      break;
    }
  }
  if (snap.capacityKwh <= 0) return { kind: 'none', title: 'No battery installed', kw: 0, why: 'Add storage from the catalog to get recommendations.', next: null, soc: 0, capacityKwh: 0 };
  let why: string;
  if (now === 'charge') why = `This hour is cleaner and cheaper than ${Math.round((1 - r.rank) * 100)}% of the next 24 h (price ${pct(r.priceVsMean)}, CO₂ ${pct(r.co2VsMean)} vs. average). Store energy now.`;
  else if (now === 'discharge') why = `This hour is dirtier and pricier than ${Math.round(r.rank * 100)}% of the next 24 h (price ${pct(r.priceVsMean)}, CO₂ ${pct(r.co2VsMean)} vs. average). Use stored energy.`;
  else why = 'The spread to upcoming hours is too small to cover the 10 % round-trip loss.';
  return {
    kind: now,
    title: now === 'charge' ? 'Charge the battery' : now === 'discharge' ? 'Discharge the battery' : 'Hold — no action',
    kw: Math.abs(sp[h]),
    why,
    next,
    soc: snap.soc,
    capacityKwh: snap.capacityKwh,
  };
}

/* ------------------------------------------------------- time parsing ---- */

const DOW_WORDS: Array<[number, string[]]> = [
  [1, ['monday', 'mon', 'lunes', 'dilluns']],
  [2, ['tuesday', 'tue', 'martes', 'dimarts']],
  [3, ['wednesday', 'wed', 'miercoles', 'dimecres']],
  [4, ['thursday', 'thu', 'jueves', 'dijous']],
  [5, ['friday', 'fri', 'viernes', 'divendres']],
  [6, ['saturday', 'sat', 'sabado', 'dissabte']],
  [0, ['sunday', 'domingo', 'diumenge']], // not "sun": that is a solar question
];

/** Find an hour index in the current week from "tuesday at 18h", "tomorrow 9am", "at 14:00", "yesterday"... */
function parseWhen(q: string, h: number, n: number): { h: number; hasHour: boolean } | null {
  const d = derived.current!;
  let day: number | null = null; // calendar day key
  const today = dayKey(h);
  if (has(q, 'tomorrow', 'manana', 'dema')) day = today + 1;
  else if (has(q, 'yesterday', 'ayer', 'ahir')) day = today - 1;
  else if (has(q, 'today', 'hoy', 'avui')) day = today;
  else {
    for (const [dow, words] of DOW_WORDS) {
      if (words.some((w) => new RegExp(`(^|[^a-z])${w}([^a-z]|$)`).test(q))) {
        for (let i = 0; i < n; i++) {
          if (new Date(d.week.ms[i]).getUTCDay() === dow) {
            day = Math.floor(d.week.ms[i] / DAY);
            break;
          }
        }
        break;
      }
    }
  }
  // an hour: "18h", "18:00", "6pm", or "at 18" / "a las 18" / "a les 18"
  let hr: number | null = null;
  for (const m of q.matchAll(/(at |a las |a les |las |les )?(?<![0-9a-z])([01]?\d|2[0-3])(?::([0-5]\d))?\s*(h\b|am\b|pm\b)?(?![0-9])/g)) {
    if (!m[1] && !m[3] && !m[4]) continue;
    hr = +m[2];
    if (m[4] === 'pm' && hr < 12) hr += 12;
    if (m[4] === 'am' && hr === 12) hr = 0;
    break;
  }
  if (day == null && hr == null) return null;
  const targetDay = day ?? today;
  const targetHour = hr ?? new Date(d.week.ms[h]).getUTCHours();
  let best = -1;
  for (let i = 0; i < n; i++) {
    const t = new Date(d.week.ms[i]);
    if (Math.floor(d.week.ms[i] / DAY) === targetDay && t.getUTCHours() === targetHour) {
      best = i;
      break;
    }
  }
  if (best < 0) return { h: -1, hasHour: hr != null };
  return { h: best, hasHour: hr != null };
}

/* ------------------------------------------------------------ answers ---- */

function atHour(h: number): string {
  const d = derived.current!;
  const sp = d.chosen.sp[h];
  const act = sp > 5 ? `charging at ${fmtKw(sp)}` : sp < -5 ? `discharging ${fmtKw(-sp)}` : 'idle';
  return (
    `**${hourLabel(h)}** — campus demand **${fmtKw(d.week.load[h])}**, solar ${fmtKw(d.pvTot[h])}, ` +
    `grid price **${d.week.price[h].toFixed(3)} €/kWh**, CO₂ ${d.week.co2[h].toFixed(3)} kg/kWh. The battery is ${act}.`
  );
}

function buildingAnswer(id: string): string {
  const c = ctx()!;
  const { d, s, snap, h } = c;
  const i = s.campus!.features.findIndex((f) => f.properties.osmId === id);
  const p = s.campus!.features[i].properties;
  const now = snap.perB[id]?.loadKw ?? 0;
  let peak = 0;
  let peakH = 0;
  let tot = 0;
  for (let k = 0; k < d.week.load.length; k++) {
    const v = d.shares[i * 168 + k] * d.week.load[k];
    tot += v;
    if (v > peak) {
      peak = v;
      peakH = k;
    }
  }
  const rank = [...s.campus!.features].sort((a, b) => (snap.perB[b.properties.osmId]?.loadKw ?? 0) - (snap.perB[a.properties.osmId]?.loadKw ?? 0)).findIndex((f) => f.properties.osmId === id) + 1;
  return (
    `**${p.short}** (${p.name}) draws **${fmtKw(now)}** right now — ${((100 * now) / Math.max(1, snap.loadKw)).toFixed(1)}% of the campus, #${rank} of ${s.campus!.features.length}. ` +
    `This week it peaks at ${fmtKw(peak)} on ${hourLabel(peakH)} and uses about ${mwh(tot)} in total.` +
    (h !== peakH ? '' : ' This is its peak hour.')
  );
}

function topConsumers(): string {
  const c = ctx()!;
  const top = [...c.s.campus!.features]
    .map((f) => [f.properties.short, c.snap.perB[f.properties.osmId]?.loadKw ?? 0] as const)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);
  return `Biggest consumers at ${hourLabel(c.h)}: ${top.map(([n, v], i) => `${i + 1}. **${n}** ${fmtKw(v)}`).join(', ')}. They are the reddest buildings on the map.`;
}

function priceAnswer(): string {
  const { d, h, n } = ctx()!;
  const w = next24(h, n);
  const lo = argmin(w, d.week.price);
  const hi = argmax(w, d.week.price);
  return (
    `Grid price now: **${d.week.price[h].toFixed(3)} €/kWh**. In the next 24 h the cheapest hour is **${hourLabel(lo)}** (${d.week.price[lo].toFixed(3)} €/kWh) ` +
    `and the most expensive is **${hourLabel(hi)}** (${d.week.price[hi].toFixed(3)} €/kWh). Prices for the next 24 h are published in advance, so the agent plans around them.`
  );
}

function co2Answer(): string {
  const { d, h, n } = ctx()!;
  const w = next24(h, n);
  const lo = argmin(w, d.week.co2);
  const hi = argmax(w, d.week.co2);
  return (
    `Grid carbon intensity now: **${d.week.co2[h].toFixed(3)} kg CO₂/kWh**. Cleanest hour in the next 24 h: **${hourLabel(lo)}** (${d.week.co2[lo].toFixed(3)}); ` +
    `dirtiest: **${hourLabel(hi)}** (${d.week.co2[hi].toFixed(3)}). CO₂ weighs 70 % of the challenge score, cost 30 %.`
  );
}

function solarAnswer(): string {
  const { d, h } = ctx()!;
  const day = dayHours(h);
  const pk = argmax(day, d.pvTot);
  return (
    `Solar output now: **${fmtKw(d.pvTot[h])}**. Today the panels produce about ${mwh(sum(day, d.pvTot))}, peaking at ${fmtKw(d.pvTot[pk])} around ${clock(pk)}. ` +
    `That covers ${((100 * sum(day, d.pvTot)) / Math.max(1, sum(day, d.week.load))).toFixed(1)}% of today's demand. Want more? Open **Solar & storage** to request a budget.`
  );
}

function loadAnswer(): string {
  const { d, h } = ctx()!;
  const day = dayHours(h);
  const pk = argmax(day, d.week.load);
  const hourOfDay = new Date(d.week.ms[h]).getUTCHours();
  const same: number[] = [];
  for (let i = 0; i < d.week.load.length; i++) if (new Date(d.week.ms[i]).getUTCHours() === hourOfDay) same.push(i);
  const avg = mean(same, d.week.load);
  const rel = d.week.load[h] / Math.max(1, avg) - 1;
  return (
    `Campus demand at ${hourLabel(h)}: **${fmtKw(d.week.load[h])}** (${pct(rel)} vs. the week's average at ${p2(hourOfDay)}:00). ` +
    `Today's peak is ${fmtKw(d.week.load[pk])} at ${clock(pk)}; daily energy ≈ ${mwh(sum(day, d.week.load))}.`
  );
}

function historyAnswer(): string {
  const { d, s, h } = ctx()!;
  const today = dayHours(h);
  const yIdx = today[0] - 1;
  let out = '';
  if (yIdx >= 0) {
    const y = dayHours(yIdx);
    const tPart = today.filter((i) => i <= h);
    const yPart = y.slice(0, tPart.length);
    const tKwh = sum(tPart, d.week.load);
    const yKwh = sum(yPart, d.week.load);
    out += `**Yesterday** (${hourLabel(y[0]).replace(/ \d\d:\d\d$/, '')}) the campus used ${mwh(sum(y, d.week.load))}, peak ${fmtKw(Math.max(...y.map((i) => d.week.load[i])))}, average price ${mean(y, d.week.price).toFixed(3)} €/kWh. `;
    out += `So far today: ${mwh(tKwh)} vs ${mwh(yKwh)} by the same time yesterday (${pct(tKwh / Math.max(1, yKwh) - 1)}). `;
  } else out += 'This is the first day of the replayed week, so there is no "yesterday" in view. ';
  const reps = s.replay!;
  const avgWeek = reps.reduce((a, w) => a + w.load.reduce((x, y) => x + y, 0), 0) / reps.length;
  const thisWeek = d.week.load.reduce((x, y) => x + y, 0);
  out += `Across all ${reps.length} weeks on record, this week's demand is ${pct(thisWeek / avgWeek - 1)} vs. the average week (${mwh(thisWeek)} vs ${mwh(avgWeek)}).`;
  return out;
}

function savingsAnswer(): string {
  const { d, snap } = ctx()!;
  const m = d.summary.mpc;
  const t = d.summary.template;
  return (
    `So far this week the battery agent saved **€${(snap.baseCostEur - snap.costEur).toFixed(0)}** and **${(snap.baseCo2Kg - snap.co2Kg).toFixed(0)} kg CO₂** vs. no battery. ` +
    `Whole week: ΔCO₂ ${m.dCo2Pct.toFixed(2)}%, ΔCost ${m.dCostPct.toFixed(2)}%, challenge score **${m.score.toFixed(2)}** (simple rule-based template: ${t.score.toFixed(2)}), ${m.violations} infractions.`
  );
}

function suggestionAnswer(): string {
  const s = suggestion();
  if (!s) return 'Still loading.';
  if (s.kind === 'none') return s.why;
  return `**${s.title}${s.kw > 5 ? ` · ${fmtKw(s.kw)}` : ''}.** ${s.why}${s.next ? ` Next change: ${s.next}.` : ''} Battery at ${(s.soc * 100).toFixed(0)}% (${mwh(s.soc * s.capacityKwh)} of ${mwh(s.capacityKwh)}).`;
}

function peakAnswer(): string {
  const { d, h } = ctx()!;
  const all = Array.from({ length: d.week.load.length }, (_, i) => i);
  const pk = argmax(all, d.week.load);
  const day = dayHours(h);
  const dp = argmax(day, d.week.load);
  return `Today's demand peak: **${fmtKw(d.week.load[dp])}** at ${clock(dp)}. Week peak: **${fmtKw(d.week.load[pk])}** on ${hourLabel(pk)}.`;
}

export const HELP =
  'I can answer questions about the campus at the time selected on the timeline, for example: what to do with the battery, prices and CO₂ in the next 24 h, solar output, ' +
  'which buildings use most, a specific building ("how much does C4 use?"), yesterday vs today, savings, or jump in time ("show Friday at 9").';

/** Answer a free-text question. */
export function ask(raw: string): Answer {
  const c = ctx();
  if (!c) return { text: 'Still loading the campus data…' };
  const q = norm(raw);

  if (has(q, 'help', 'ayuda', 'ajuda', 'what can', 'que puedes', 'que pots')) return { text: HELP };

  // a specific building?
  const feats = c.s.campus!.features;
  const hit = feats.find((f) => {
    const short = norm(f.properties.short).replace(/^edifici\s+/, '').trim();
    const name = norm(f.properties.name);
    return (short.length >= 2 && new RegExp(`(^|[^a-z0-9])${short.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(q)) || (name.length > 5 && q.includes(name));
  });

  // which topic is the question about? (null = none recognised)
  const history = has(q, 'yesterday', 'ayer', 'ahir', 'history', 'histor', 'last week', 'compare', 'compar', 'trend', 'tendencia', 'previous', 'before');
  const topic: (() => string) | null = has(q, 'should', 'suggest', 'recommend', 'action', 'do now', 'hacer', 'fer', 'recomien', 'recoman', 'battery', 'bateria', 'charge', 'carga', 'carrega')
    ? suggestionAnswer
    : history
      ? historyAnswer
      : has(q, 'saving', 'save', 'saved', 'ahorr', 'estalvi', 'score', 'impact', 'puntu')
        ? savingsAnswer
        : has(q, 'peak', 'pico', 'punta', 'max')
          ? peakAnswer
          : has(q, 'co2', 'carbon', 'emission', 'emisi', 'clean', 'limpi', 'dirty', 'sucia', 'brut')
            ? co2Answer
            : has(q, 'price', 'precio', 'preu', 'cheap', 'barat', 'expensive', 'caro', 'cost', 'tarif')
              ? priceAnswer
              : has(q, 'solar', 'sun', 'pv', 'sol', 'fotovolt', 'panel', 'placa')
                ? solarAnswer
                : has(q, 'building', 'edificio', 'edifici', 'most', 'biggest', 'top', 'mas consum', 'mes consum')
                  ? topConsumers
                  : has(q, 'load', 'demand', 'consum', 'demanda', 'usage', 'use', 'now', 'ahora', 'ara', 'kw', 'energy', 'energia')
                    ? loadAnswer
                    : null;

  // a time reference? ("tuesday at 18h", "tomorrow", "at 9am")
  const when = parseWhen(q, c.h, c.n);
  const nav = has(q, 'go to', 'show', 'jump', 'move', 'take me', 've a', 'ves a', 'muestra', 'mostra');
  if (when && when.h < 0) return { text: 'That time is outside the replayed week. Pick another week in the header, or ask about a day shown on the timeline.' };
  if (when && !(history && !when.hasHour)) {
    const go = when.h * 60 + 30;
    if (hit || (topic && !nav)) {
      // answer the question as seen from that moment: move the clock first, then answer
      const moved = when.h !== c.h;
      if (moved) useSim.getState().setTMin(go);
      const body = hit ? buildingAnswer(hit.properties.osmId) : topic!();
      return moved ? { text: `${body}\n\nTimeline moved to ${hourLabel(when.h)}.`, goTo: go } : { text: body };
    }
    return { text: `${atHour(when.h)}\n\nTimeline moved there.`, goTo: go };
  }
  if (hit) return { text: buildingAnswer(hit.properties.osmId) };
  if (topic) return { text: topic() };
  return { text: `I'm not sure I got that. ${HELP}` };
}
