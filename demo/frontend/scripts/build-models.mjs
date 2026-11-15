/**
 * Generates the replay of every built-in model (same schema as public/data/replay.json) + public/data/models/index.json.
 *   npm run build:models            (needs <repo>/data/train and <repo>/.venv; ~2 min)
 * Standard MPC is written to public/data/replay.json (the default the app always had); the others to public/data/models/<id>.json.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const front = path.resolve(here, '..');
const repo = path.resolve(front, '..', '..');
const py = existsSync(path.join(repo, '.venv', 'Scripts', 'python.exe')) ? path.join(repo, '.venv', 'Scripts', 'python.exe') : path.join(repo, '.venv', 'bin', 'python');
const outDir = path.join(front, 'public', 'data', 'models');
mkdirSync(outDir, { recursive: true });

const BUILTIN = [
  { id: 'standard', name: 'Standard MPC', desc: 'agent/agent.py: exact 24 h MPC (challenge winner candidate)', agent: 'agent/agent.py', out: path.join(front, 'public', 'data', 'replay.json'), url: '/data/replay.json' },
  { id: 'hard', name: 'Hard Mode MPC', desc: 'agent_hard/: 48→24 h stochastic MPC, run here with the Hard Mode observation (3 h price window) on the 2 MWh battery', agent: 'agent_hard/agent.py', hardObs: true, out: path.join(outDir, 'hard.json'), url: '/data/models/hard.json' },
  { id: 'baseline', name: 'Baseline template', desc: 'experiments/baseline: the organisers’ template agent', agent: 'experiments/baseline/template_agent.py', out: path.join(outDir, 'baseline.json'), url: '/data/models/baseline.json' },
];

const index = [];
for (const m of BUILTIN) {
  console.log(`== ${m.id}`);
  const args = ['-I', path.join(here, 'export_replay.py'), '--repo', repo, '--agent', path.join(repo, m.agent), '--out', m.out, '--name', m.agent];
  if (m.hardObs) args.push('--hard-obs');
  const r = spawnSync(py, args, { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error(`!! ${m.id} failed`);
    index.push({ id: m.id, name: m.name, desc: m.desc, builtin: true, available: false });
    continue;
  }
  const j = JSON.parse(readFileSync(m.out, 'utf8'));
  const w = j.weeks.map((x) => x.mpc);
  index.push({
    id: m.id, name: m.name, desc: m.desc, builtin: true, available: true, url: m.url,
    meanScore: w.reduce((a, x) => a + x.score, 0) / w.length,
    violations: w.reduce((a, x) => a + x.viol, 0),
    msPerStep: j.ms_per_step ?? null,
  });
}
index.push({ id: 'none', name: 'No battery', desc: 'Reference: the campus without any battery control (score 0 by definition)', builtin: true, available: true, url: null, meanScore: 0, violations: 0, msPerStep: 0 });
writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));
console.log('wrote models/index.json');
