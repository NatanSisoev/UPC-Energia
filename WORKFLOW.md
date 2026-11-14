# Team workflow — Natan, Aiman, Sami

Three people, three Claude Code agents, one repo (`NatanSisoev/Datathon-FME`), two deliverables:

1. **MODEL track** — best score on the leaderboard (`agent.py` / `submission.zip`).
2. **DEMO track** — best presentation/demo for the jury (story, visuals, interactive app).

The jury decides *with* the presentation, so the DEMO track is not optional polish: it needs real owners from the start.

## 1. Branches

| Branch | Who | Purpose |
|---|---|---|
| `main` | everyone (via merge/PR) | Always working. Always contains the **best known submittable agent** + shared infra. |
| `natan` | Natan | personal work branch |
| `aiman` | Aiman | personal work branch |
| `sami` | Sami | personal work branch |

- Each human works **only on their own branch**; their Claude commits there too. Never commit directly to someone else's branch.
- Optional sub-branches for risky experiments: `<name>/<topic>` (e.g. `sami/lp-optimizer`). Delete once merged or abandoned.
- Track ownership is a **table to fill in at kickoff** (edit this file on `main`):

| Person | Primary track | Secondary |
|---|---|---|
| Natan | MODEL - optimizer (oracle bound, rules, MPC) | demo help |
| Aiman | MODEL - forecasting + EDA | optimizer help |
| Sami | DEMO - frontend, story, slides | data insights |

## 2. Push often, pull deliberately

- **Commit small, push every time you reach something that runs** (at least every ~30–45 min). Unpushed work doesn't exist for teammates.
- **Need something from a teammate?** Don't copy-paste files over chat. Fetch it:
  ```bash
  git fetch origin
  git merge origin/aiman            # whole branch, or:
  git checkout origin/aiman -- demo/app.py   # a single file
  ```
  Then tell them if you changed their files (you shouldn't — see §3).
- Pull `main` into your branch at least **every hour and before starting a new task**: `git fetch origin && git merge origin/main`.
- Rebase is allowed on your own *unpushed* commits only. **Never force-push** any shared branch (`main`, or a branch a teammate has pulled).

## 3. Ownership of folders (avoids merge conflicts)

| Path | Track | Rule |
|---|---|---|
| `agent/`, `models/`, `notebooks/`, `experiments/` | MODEL | Whoever works on the model. Experiments in `experiments/<name>/`, not in `agent/`. |
| `sim/` | shared infra | Changes go through `main` (see §4). Don't fork the simulator privately — scores must be comparable. |
| `demo/` | DEMO | Presentation, app, figures. |
| `tests/` | shared | Add tests with your code. |
| `CLAUDE.md`, `CHALLENGE.md`, `WORKFLOW.md` | shared | Only edit on `main` via small PR/merge; announce in chat. |

Two people editing the same file on different branches = conflict. If you must, coordinate in chat first.

## 4. What goes to `main`

Merge to `main` when (and only when):
- **A new best agent**: beats the current `main` agent on the local simulator (same data, same metric) *and* passes `python -m sim.check agent/agent.py` with 0 violations and <60 s. Put the score in the commit message.
- **Shared infra** changes (`sim/`, data loaders, tests, docs) that others need.
- **A demo milestone** that others should be able to build on.

How: `git fetch && git merge origin/main` into your branch → run `pytest` + `python -m sim.evaluate` → push your branch → open a PR to `main` (`gh pr create`) or, for speed, merge locally and `git push origin main` **if the above checks pass**. Tell the others after: "main updated: <what>, new score X".

Never push to `main`: broken code, failing tests, unevaluated models, datasets, secrets.

## 5. Leaderboard submission discipline

Quota is **10 per shift, 3 shifts** — a scarce shared resource for the whole team.
- Only submit what is already on `main` (or an explicitly agreed branch commit), after a clean local eval + the free web "Validació Ràpida".
- One person submits at a time; announce in chat *before* ("submitting commit abc123, expect ~X"). Log each submit in `SUBMISSIONS.md` (shift, commit, local score, leaderboard score).
- Don't burn quota to "test if it runs" — use the free quick validation.
- Remember the leaderboard is the **public 50 %**; trust local cross-validation on whole weeks over small public gains.
- **Never commit the team PIN.**

## 6. Rules for each Claude agent

1. **Read `CLAUDE.md` and `CHALLENGE.md` first.** Check `git branch --show-current`: you work on your human's branch only.
2. At session start: `git fetch origin && git status && git log --oneline origin/main -5`. Merge `origin/main` if behind.
3. Stay in your track's folders. If you need a change elsewhere, tell the human to ask the owner or make it on `main` as a tiny separate commit.
4. Commit with prefix: `[model]`, `[demo]`, `[sim]`, `[docs]`, `[infra]`. Message includes the local score when relevant.
5. Every agent change is evaluated with `python -m sim.evaluate` (and a *whole-week* CV, not just the full train). Report numbers, not feelings.
6. Never push to another person's branch, never force-push, never rewrite shared history, never commit data/PIN/`.pkl` > 5 MB without asking.
7. Don't touch the challenge website with real submissions unless the human explicitly asks you to.
8. When your human says "tell the others": write/update `docs/HANDOFF.md` entries (see below) rather than relying on chat memory.
9. Be skeptical of numbers: always re-run before claiming an improvement; say clearly when something is untested.

## 7. Communication between agents

Agents can't talk to each other; the repo is the channel.
- `docs/HANDOFF.md` — append-only log on `main`: `date · who · what changed · how to use it · score`. Read it at session start.
- `SUBMISSIONS.md` — submission log (see §5).
- Open questions for the team → `docs/QUESTIONS.md`.

## 8. Timeline (adapt at kickoff)

- **Sat daytime**: baseline running, data understood, simulator validated against official `environment.py`; demo skeleton + storyline.
- **Sat night**: first strong agent submitted; demo content takes shape.
- **Sun morning**: freeze model features; final candidate chosen by local whole-week CV, not leaderboard noise.
- **Sun before close**: demo rehearsal, slides, code cleanup (the jury reads the code), final submit.
