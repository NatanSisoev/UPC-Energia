/**
 * Numeric parity check: TypeScript engine vs the Python simulator/agents.
 *   node --experimental-strip-types scripts/validate.ts
 * Re-runs both agents on every real week stored in public/data/replay.json and compares the setpoint
 * trace, the final SOC and the challenge score against what sim/ + agent/agent.py produced.
 */
import { readFileSync } from 'node:fs';
import { CHALLENGE_SPEC, simulateWeek } from '../src/sim/challenge.ts';

const replay = JSON.parse(readFileSync(new URL('../public/data/replay.json', import.meta.url), 'utf8'));
let worst = { sp: 0, soc: 0, score: 0 };
let t0 = performance.now();
let steps = 0;
for (const wk of replay.weeks) {
  for (const kind of ['mpc', 'template'] as const) {
    const ref = wk[kind];
    const r = simulateWeek(wk, CHALLENGE_SPEC, kind);
    steps += r.n;
    let dsp = 0;
    let dsoc = 0;
    for (let i = 0; i < r.n; i++) {
      dsp = Math.max(dsp, Math.abs(r.sp[i] - ref.sp[i]));
      dsoc = Math.max(dsoc, Math.abs(r.socEnd[i] - ref.soc[i]));
    }
    const dscore = Math.abs(r.metrics.score - ref.score);
    worst = { sp: Math.max(worst.sp, dsp), soc: Math.max(worst.soc, dsoc), score: Math.max(worst.score, dscore) };
    if (dsp > 1e-3 || dscore > 1e-6 || r.metrics.violations !== ref.viol)
      console.log('MISMATCH', wk.start, kind, { dsp, dsoc, ts: r.metrics.score, py: ref.score, viol: r.metrics.violations });
  }
}
console.log('weeks', replay.weeks.length, 'steps', steps, 'ms/step', ((performance.now() - t0) / steps).toFixed(3));
console.log('worst |setpoint diff| kW', worst.sp.toExponential(2), '| |SOC diff| kWh', worst.soc.toExponential(2), '| |score diff|', worst.score.toExponential(2));
process.exit(worst.sp < 1e-3 && worst.score < 1e-6 ? 0 : 1);
