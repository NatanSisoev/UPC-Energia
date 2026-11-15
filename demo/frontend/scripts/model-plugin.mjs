/**
 * Vite middleware for the model selector (dev + preview):
 *   GET    /api/models              uploaded models [{id,name,status,stage,...}]
 *   POST   /api/models?name=x.zip   raw challenge-format ZIP in the body (<= 25 MB) -> 202 {id}; validation + simulation run in the background
 *   GET    /api/models/:id          status of one model (poll while status === 'processing')
 *   GET    /api/models/:id/replay   its replay json (same schema as public/data/replay.json)
 *   DELETE /api/models/:id
 *
 * !! LOCAL DEMO TOOL ONLY. It executes user-provided Python on the developer's machine (after an AST scan whitelist,
 * with a hard timeout). There is no sandbox and no real network isolation; never expose this server to untrusted users.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 10 * 60 * 1000;
const ID_RE = /^[a-f0-9]{10}$/;

export function modelPlugin() {
  const front = process.cwd();
  const repo = path.resolve(front, '..', '..');
  const root = path.join(front, '.uploads');
  const py = existsSync(path.join(repo, '.venv', 'Scripts', 'python.exe')) ? path.join(repo, '.venv', 'Scripts', 'python.exe') : path.join(repo, '.venv', 'bin', 'python');
  const jobs = new Map(); // id -> live status while processing

  const metaPath = (id) => path.join(root, id, 'meta.json');
  const readMeta = (id) => {
    try {
      return JSON.parse(readFileSync(metaPath(id), 'utf8'));
    } catch {
      return null;
    }
  };
  const writeMeta = (id, m) => writeFileSync(metaPath(id), JSON.stringify(m));
  const status = (id) => jobs.get(id) ?? readMeta(id);

  function run(id, name, hardObs) {
    const dir = path.join(root, id);
    const job = { id, name, status: 'processing', stage: 'extract', progress: 0, createdAt: Date.now() };
    jobs.set(id, job);
    writeMeta(id, job);
    const args = ['-I', path.join(front, 'scripts', 'model_tool.py'), '--repo', repo, '--zip', path.join(dir, 'upload.zip'), '--dir', dir];
    if (hardObs) args.push('--hard-obs');
    // minimal env; proxies pointed at a dead port as a cheap (non-guaranteed) network cut-off
    const env = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9' };
    const child = spawn(py, args, { cwd: dir, env, windowsHide: true });
    const timer = setTimeout(() => {
      job.status = 'failed';
      job.error = 'timed out (10 min)';
      child.kill();
    }, TIMEOUT_MS);
    let buf = '';
    const onLine = (line) => {
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        return;
      }
      if (o.stage) {
        job.stage = o.stage;
        if (o.week) job.progress = o.week / o.of;
      }
      if (o.done) {
        if (o.ok) Object.assign(job, { status: 'ready', stage: 'done', progress: 1, meanScore: o.meanScore, violations: o.violations, msPerStep: o.msPerStep });
        else Object.assign(job, { status: 'failed', error: o.error, problems: o.problems });
      }
    };
    child.stdout.on('data', (d) => {
      buf += d;
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        onLine(buf.slice(0, i));
        buf = buf.slice(i + 1);
      }
    });
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('close', (code) => {
      clearTimeout(timer);
      if (job.status === 'processing') {
        job.status = 'failed';
        job.error = `validator exited with code ${code}: ${err.slice(-400)}`;
      }
      writeMeta(id, job);
      jobs.delete(id);
    });
  }

  const handler = (req, res, next) => {
    const url = new URL(req.url ?? '', 'http://x');
    if (!url.pathname.startsWith('/api/models')) return next();
    const json = (code, body) => {
      res.statusCode = code;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(body));
    };
    const parts = url.pathname.split('/').filter(Boolean); // api models [id] [replay]
    const id = parts[2];
    if (id && !ID_RE.test(id)) return json(400, { error: 'bad id' });

    if (!id && req.method === 'GET') {
      const list = existsSync(root) ? readdirSync(root).filter((d) => ID_RE.test(d)).map(status).filter(Boolean) : [];
      return json(200, list.sort((a, b) => a.createdAt - b.createdAt));
    }
    if (!id && req.method === 'POST') {
      const chunks = [];
      let size = 0;
      let aborted = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES) {
          aborted = true;
          json(413, { error: 'ZIP is larger than 25 MB' });
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (aborted) return;
        const body = Buffer.concat(chunks);
        if (body.length < 4 || body.readUInt32LE(0) !== 0x04034b50) return json(400, { error: 'not a ZIP file' });
        const newId = randomBytes(5).toString('hex');
        mkdirSync(path.join(root, newId), { recursive: true });
        writeFileSync(path.join(root, newId, 'upload.zip'), body);
        const name = String(url.searchParams.get('name') ?? 'model.zip').replace(/\.zip$/i, '').replace(/[^\w .-]/g, '').slice(0, 40) || 'model';
        run(newId, name, url.searchParams.get('hard') === '1');
        json(202, { id: newId });
      });
      return;
    }
    if (id && !parts[3] && req.method === 'GET') {
      const m = status(id);
      return m ? json(200, m) : json(404, { error: 'unknown model' });
    }
    if (id && parts[3] === 'replay' && req.method === 'GET') {
      const f = path.join(root, id, 'replay.json');
      if (!existsSync(f)) return json(404, { error: 'no replay (model not ready)' });
      res.setHeader('Content-Type', 'application/json');
      return createReadStream(f).pipe(res);
    }
    if (id && !parts[3] && req.method === 'DELETE') {
      if (jobs.has(id)) return json(409, { error: 'still processing' });
      rmSync(path.join(root, id), { recursive: true, force: true });
      return json(200, { ok: true });
    }
    json(405, { error: 'method not allowed' });
  };
  return {
    name: 'campus-models',
    configureServer(s) {
      s.middlewares.use(handler);
    },
    configurePreviewServer(s) {
      s.middlewares.use(handler);
    },
  };
}
