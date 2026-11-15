/**
 * The guided tour: "A Monday in the life of the campus energy manager", 9 beats, click-through (no timers).
 *
 * HOW TO EDIT
 *  - A beat is one `TourStep`. `enter()` puts the real app into the beat's STARTING state; `clicks` are micro-reveals
 *    (each Next press runs one before moving on). Both must be ABSOLUTE (set a state, never toggle): the runner calls
 *    `resetBase()` (real campus, Monday 11:00, 2D, nothing open) and then `enter()` + the first n clicks for every
 *    Back / jump, so a beat looks the same however it is reached.
 *  - Text may be a function of `TF` (tour/facts.ts): every number on a card is read from live data, never typed.
 *  - `spot` is a CSS selector for the soft spotlight ring (data-tour="..." attributes exist on the header pills,
 *    calendar, model menu, timeline and bell / chat buttons).
 */
import { useSim } from '../store/useSim';
import { useInsightsUi } from '../components/Insights';
import { openFaultPanel } from '../live/faultAlertStore';
import { useUi } from '../store/useUi';
import type { Cover } from './actions';
import { addSolarPanel, ask, bigRoof, faultScene, faultStep, fly, go, home, openCharts, popup, PAST_WEEK, pulse, side, trunkCable } from './actions';
import { FEATURED_BATTERY, type TF } from './facts';

export type Text = string | ((f: TF) => string);
export interface RunCtx {
  /** true only for the item the audience actually watches (Next press); replays are instant */
  animate: boolean;
}
export interface Click {
  /** shown on the Next button: "Next: <label>" */
  label: string;
  /** "Now: ..." line while this micro-step is on screen */
  action: Text;
  spot?: string;
  run: (c: RunCtx) => void | Promise<void>;
}
export interface TourStep {
  id: string;
  kicker: string;
  /** short name for the Next button when this beat comes next */
  short: string;
  title: Text;
  bullets: (f: TF) => string[];
  /** "Now: ..." line for the starting state */
  action: Text;
  spot?: string;
  notes: string;
  /** one line linking to the next beat (chip on the beat's last step) */
  bridge: string;
  /** fully-covering slide for a given micro-step count (0 = just entered) */
  cover?: (sub: number) => Cover;
  enter: (c: RunCtx) => void | Promise<void>;
  clicks?: Click[];
}

const st = () => useSim.getState();
const sgn = (v: number) => (v < 0 ? '−' : '+');
const per = (v: number) => `${sgn(v)}${Math.abs(v).toFixed(1)}%`;

export const STEPS: TourStep[] = [
  /* 0 ------------------------------------------------------------------ */
  {
    id: 'hook',
    kicker: '1 · The problem',
    short: 'The control room',
    title: 'Data nobody can read is data nobody can act on',
    bullets: (f) => [`One real hour of the campus: ${f.buildings} buildings, a battery, a price and a carbon signal.`, 'Hundreds of numbers per hour, 24/7.'],
    action: 'Now: the raw feed an energy manager gets today',
    notes: 'This is one real row from the replay data, not a mock-up. Transition: “So we built a control room.”',
    bridge: 'So we built a control room.',
    cover: (sub) => (sub === 0 ? 'json' : null),
    enter: () => {
      side('chat');
      home(false);
    },
    clicks: [{ label: 'reveal the control room', action: 'Now: the same data, as a live map', run: () => {}, spot: '[data-tour="time-pill"]' }],
  },
  /* 1 ------------------------------------------------------------------ */
  {
    id: 'see',
    kicker: '2 · See the campus',
    short: 'See the campus',
    title: 'One screen: where the power goes, right now',
    bullets: (f) => [
      `LIVE pill: Monday ${f.week}, ${f.fmtKw(f.demandKw)} demand, ${f.fmtKw(f.solarKw)} solar, battery at ${f.socPct.toFixed(0)} %.`,
      f.hottest ? `Heat colours: ${f.hottest.name} is the hungriest building (${f.fmtKw(f.hottest.kw)}).` : 'Heat colours show demand per building.',
      `${f.cables} cable segments with moving dots in the flow direction; the battery yard and substation change colour with their state.`,
    ],
    action: 'Now: the live view (hover any building for its card)',
    spot: '[data-tour="time-pill"]',
    notes: 'Point at the LIVE pill, the weather chip and the heat colours. Hover a big building for its card. Transition: “Colours tell how much, not from where.”',
    bridge: 'Colours tell how much, not from where.',
    enter: (c) => {
      side('chat');
      home(c.animate);
    },
    clicks: [
      { label: '3D view', action: 'Now: switching the map to 3D', run: (c) => { st().setMode3d(true); fly({ pitch: 52, bearing: -20 }, c.animate); } },
      { label: 'dusk lighting', action: 'Now: sun position and weather follow the clock (dusk shown)', run: () => st().setSunLock(19) },
      { label: 'zoom the timeline to a day', action: 'Now: timeline in day zoom, NOW marker and history / forecast split', spot: '[data-tour="timeline"]', run: () => useUi.getState().setZoom('day') },
    ],
  },
  /* 2 ------------------------------------------------------------------ */
  {
    id: 'solar',
    kicker: '3 · Building and solar',
    short: 'A building and its solar',
    title: (f) => `${f.sel || f.roof}: what it draws and where its power comes from`,
    bullets: (f) => [
      `Click a building and the sidebar opens: stats, a grid / battery / solar supply bar, and its history.`,
      `Solar panels tab: every panel row with its live output and per-panel health. ${f.roof} has ${f.panels} installed.`,
    ],
    action: (f) => `Now: ${f.roof} selected, Overview tab`,
    spot: 'aside',
    notes: 'Open the Overview, then the Solar panels tab. Add two panels: the violet roof and the SIMULATED pill appear. Open the impact pane to show the CO2 / cost delta. Transition: “But where does a building’s power actually come from?”',
    bridge: 'But where does that power physically come from?',
    enter: (c) => {
      const r = bigRoof();
      if (r) st().select(r.id);
      fly({ zoom: 17.6 }, c.animate);
    },
    clicks: [
      { label: 'Solar panels tab', action: (f) => `Now: ${f.roof} → Solar panels tab (per-panel health)`, spot: 'aside', run: () => st().setPanelUi({ buildingTab: 'solar' }) },
      { label: '+ Add panel', action: (f) => `Now: panel row added to ${f.roof}, ${f.panels} installed`, spot: 'button[title^="Add one panel"]', run: () => { const r = bigRoof(); if (r) addSolarPanel(r.id); pulse('[data-tour="sim-pill"]'); } },
      { label: '+ Add panel again', action: (f) => `Now: another row added, ${f.panels} installed; the roof turns violet`, spot: '[data-tour="sim-pill"]', run: () => { const r = bigRoof(); if (r) addSolarPanel(r.id); } },
      { label: 'impact report', action: (f) => `Now: impact vs the real campus, CO₂ ${per(f.dCo2Pct)}, cost ${per(f.dCostPct)} this week`, spot: '[data-tour="sim-pill"]', run: () => popup('scenario', true) },
    ],
  },
  /* 3 ------------------------------------------------------------------ */
  {
    id: 'supply',
    kicker: '4 · Where it comes from',
    short: 'Supply origin',
    title: 'Click a cable: the power mix and its history',
    bullets: () => ['Each cable shows its week of flow, measured then forecast, and the share from grid, battery and solar.', 'Supply bars on the timeline show the same mix hour by hour.'],
    action: 'Now: the trunk cable out of the substation',
    spot: 'aside',
    notes: 'Read the % mix on the trunk cable, then the battery yard. Hover the timeline for the supply tooltip. Transition: “So what happens when a piece breaks?”',
    bridge: 'So what happens when a piece breaks?',
    enter: () => {
      const c = trunkCable();
      if (c) st().select(c);
    },
    clicks: [
      { label: 'battery yard', action: (f) => `Now: battery yard, ${f.socPct.toFixed(0)} % charged, ${f.battKw < -5 ? 'discharging' : f.battKw > 5 ? 'charging' : 'idle'}`, spot: 'aside', run: () => st().select('battery') },
      { label: 'substation', action: 'Now: the grid substation, the only way in', spot: 'aside', run: () => st().select('substation') },
      { label: 'supply mix on the timeline', action: 'Now: hover the timeline: grid / battery / solar share of every hour', spot: '[data-tour="timeline"]', run: () => { st().select(null); side(null); } },
    ],
  },
  /* 4 ------------------------------------------------------------------ */
  {
    id: 'faults',
    kicker: '5 · What if it breaks',
    short: 'Fault injection',
    title: 'Break things on purpose, watch the agent re-plan',
    bullets: () => ['The yard has an extra simulated unit, so the agent has something left to plan with.', 'Faults: a battery unit, a PV array, a grid outage. The SIMULATED pill lists every difference and resets in one click.'],
    action: 'Now: yard with an added (simulated) unit',
    spot: '[data-tour="sim-pill"]',
    notes: 'Break the original unit, then a PV array, then the outage (the app goes dark / night). Transition: “The alarms now tell the story.”',
    bridge: 'Now the alarms have a story to tell.',
    enter: () => {
      faultScene(0);
      st().select('battery');
    },
    clicks: [
      { label: 'break a battery unit', action: 'Now: original battery unit offline (red), the agent re-plans with what is left', spot: '[data-tour="sim-pill"]', run: () => { faultStep(1); pulse('[data-tour="sim-pill"]'); } },
      { label: 'break a solar array', action: (f) => `Now: ${f.roof} PV array offline`, spot: '[data-tour="sim-pill"]', run: () => { faultStep(2); pulse('[data-tour="sim-pill"]'); } },
      { label: 'grid outage at night', action: 'Now: 3 h grid outage at night (dark theme)', spot: '[data-tour="sim-pill"]', run: () => { faultStep(3); popup('scenario', true); } },
    ],
  },
  /* 5 ------------------------------------------------------------------ */
  {
    id: 'alerts',
    kicker: '6 · Alerts and assistant',
    short: 'Alerts and the assistant',
    title: (f) => `${f.alarmsActive} active, ${f.alarmsUpcoming} upcoming, ${f.alarmsPast} past alarms`,
    bullets: () => ['Active, upcoming (predicted) and past. A click jumps the timeline to the moment.', 'Ask the assistant in plain language; it explains and proposes the next action.'],
    action: 'Now: the alarm panel (bell)',
    spot: '[data-tour="alarms"]',
    notes: 'Show the three tabs, open the fault panel, then ask “What happened?”. Transition: “Fixing it costs money. What should we buy?”',
    bridge: 'Fixing it costs money. What should we buy?',
    enter: () => {
      faultScene(3);
      side('alarms');
    },
    clicks: [
      { label: 'fault details', action: 'Now: the fault panel with recommended actions', spot: 'aside', run: () => openFaultPanel() },
      { label: 'ask “what happened?”', action: 'Now: asking the assistant “What happened?”', spot: 'aside', run: () => ask('What happened? Explain the active fault') },
    ],
  },
  /* 6 ------------------------------------------------------------------ */
  {
    id: 'catalogue',
    kicker: '7 · Investment',
    short: 'Catalogue and payback',
    title: 'Which equipment pays for itself?',
    bullets: (f) => [f.featPayback ? `${f.featPayback.name}: price ${f.fmtEur(f.featPayback.price)}, saves ${f.fmtEur(f.featPayback.saving)} a year, payback ${Number.isFinite(f.featPayback.years) ? f.featPayback.years.toFixed(1) + ' years' : 'never'}.` : 'Payback of every battery and panel is computed from the replayed weeks…', 'Add to the simulated yard, or ask a supplier for a budget with the campus data pre-filled.'],
    action: 'Now: the equipment catalogue',
    notes: 'Add a battery (Simulate), read the payback bar, highlight Ask budget (do not send). Transition: “Can we trust these numbers? Let us look at the forecast.”',
    bridge: 'Can we trust the numbers? Back to the forecast.',
    enter: () => go('/catalogue'),
    clicks: [
      { label: 'simulate a battery', action: 'Now: adding a 2.76 MWh unit to the simulated yard', run: () => { st().installBattery(FEATURED_BATTERY); } },
      { label: 'ask budget (preview)', action: 'Now: “Ask budget” opens a pre-filled e-mail, here only highlighted', spot: 'a[href^="mailto:"]', run: () => pulse('a[href^="mailto:"]', 100) },
      { label: 'back to the map: impact', action: (f) => `Now: the SIMULATED pill: CO₂ ${per(f.dCo2Pct)}, cost ${per(f.dCostPct)}, with payback`, spot: '[data-tour="sim-pill"]', run: () => { go('/'); popup('scenario', true); } },
    ],
  },
  /* 7 ------------------------------------------------------------------ */
  {
    id: 'forecast',
    kicker: '8 · Forecast and models',
    short: 'Forecast and models',
    title: 'Plan ahead, then check against what really happened',
    bullets: (f) => [`Week of ${f.week}: measured up to NOW, forecast after it (hatched). The agent plans on the forecast.`, `Models: ${f.models.filter((m) => m.available).map((m) => m.name).join(', ')}. Your own agent ZIP can be uploaded and replayed.`],
    action: 'Now: calendar: any recorded day opens its week',
    spot: '[data-tour="calendar"]',
    notes: 'Mention that a challenge-format ZIP can be uploaded in the model menu (validated, then replayed). Transition: “Zoom out: what does the whole year look like?”',
    bridge: 'Zoom out: what does the whole year look like?',
    enter: () => {
      st().setWeek(PAST_WEEK);
      popup('calendar', true);
    },
    clicks: [
      { label: 'generate forecast', action: 'Now: generating the forecast for the rest of the week', spot: '[data-tour="timeline"]', run: (c) => { popup('calendar', false); if (c.animate) st().generateForecast(); else useSim.setState({ fcStage: 'ready', fcReveal: 999 }); } },
      { label: 'measured vs forecast', action: 'Now: measured overlay vs forecast, charts open', spot: '[data-tour="timeline"]', run: () => { useSim.setState({ fcStage: 'ready', fcReveal: 999 }); st().setPrefs({ showActual: true }); openCharts(); } },
      { label: 'model: template', action: (f) => `Now: model “${f.models.find((m) => m.id === 'baseline')?.name ?? 'template'}”, week score ${f.modelWeekScore.toFixed(2)}`, spot: '[data-tour="model"]', run: async () => { popup('model', true); await st().setModel('baseline'); } },
      { label: 'model: MPC', action: (f) => `Now: model “${f.modelName}”, week score ${f.modelWeekScore.toFixed(2)}`, spot: '[data-tour="model"]', run: async () => { await st().setModel('standard'); } },
      { label: 'model: hard mode', action: (f) => `Now: model “${f.modelName}”, week score ${f.modelWeekScore.toFixed(2)}`, spot: '[data-tour="model"]', run: async () => { if (st().models.some((m) => m.id === 'hard' && m.available)) await st().setModel('hard'); } },
    ],
  },
  /* 8 ------------------------------------------------------------------ */
  {
    id: 'close',
    kicker: '9 · Plots and results',
    short: 'Plots and results',
    title: 'The year in plots, then the three numbers that matter',
    bullets: (f) => [`Charts panel: demand, solar, price, CO₂ and battery for the week (${f.week}).`, 'What-if: change the CO₂ / cost weight or the battery size and the real agent re-runs.'],
    action: 'Now: the charts panel under the timeline',
    spot: '[data-tour="timeline"]',
    notes: 'Open the What-if plots, drag the weight slider. Close on the headline slide. Transition: “That is the Monday. Questions?”',
    bridge: 'That was the Monday. Questions?',
    cover: (sub) => (sub === 1 ? 'insights' : sub === 2 ? 'facts' : null),
    enter: () => {
      side('chat');
      openCharts();
    },
    clicks: [
      { label: 'what-if plots', action: 'Now: insights: what-if, CO₂ vs cost weight', run: () => { useInsightsUi.getState().setTab('whatif'); } },
      { label: 'headline results', action: 'Now: the three numbers', run: () => {} },
    ],
  },
];

