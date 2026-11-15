import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { ArrowUp, BatteryCharging, BatteryMedium, Pause as PauseIco, PanelRightClose } from 'lucide-react';
import { useSim } from '../store/useSim';
import { ask, hourLabel, suggestion } from '../lib/assistant';
import { activeAt, useAlarms } from '../lib/alarms';
import { fmtKw } from '../lib/format';
import { useViewMode } from '../lib/mode';


interface Msg {
  role: 'user' | 'bot';
  /** stream this reply in (false for the greeting history) */
  stream?: boolean;
  text: string;
}

const CHIPS = ['In which buildings can we add a solar panel?', 'What should we do now?', 'Any alarms?', 'Cheapest hour in the next 24 h?', 'Which buildings use most?', 'How does today compare to yesterday?', 'How much have we saved?'];

/** Render **bold** spans and line breaks. */
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split('\n').map((line, li) => (
        <Fragment key={li}>
          {li > 0 && <br />}
          {line.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith('**') ? <b key={i}>{part.slice(2, -2)}</b> : <Fragment key={i}>{part}</Fragment>))}
        </Fragment>
      ))}
    </>
  );
}

/**
 * LLM-style reply: a short "thinking" pause with animated dots, then the text streams in a few characters at a
 * time. Open `**bold**` spans are closed on the fly so formatting appears progressively.
 */
function StreamedReply({ text, onTick }: { text: string; onTick: () => void }) {
  const [n, setN] = useState(0);
  const [thinking, setThinking] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setThinking(false), 550);
    return () => window.clearTimeout(t);
  }, []);
  useEffect(() => {
    if (thinking) return;
    const id = window.setInterval(() => {
      setN((v) => {
        if (v >= text.length) {
          window.clearInterval(id);
          return v;
        }
        // variable chunk size gives a natural, slightly uneven cadence
        return Math.min(text.length, v + 2 + Math.floor(Math.random() * 4));
      });
    }, 22);
    return () => window.clearInterval(id);
  }, [thinking, text]);
  useEffect(() => {
    onTick();
  }, [n, thinking, onTick]);

  if (thinking) {
    return (
      <span className="inline-flex items-center gap-1 py-1" aria-label="Assistant is thinking">
        {[0, 1, 2].map((i) => (
          <span key={i} className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--muted)]" style={{ animationDelay: `${i * 140}ms` }} />
        ))}
      </span>
    );
  }
  let shown = text.slice(0, n);
  if ((shown.match(/\*\*/g)?.length ?? 0) % 2 === 1) shown += '**';
  const done = n >= text.length;
  return (
    <>
      <Rich text={shown} />
      {!done && <span className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-[var(--muted)]" />}
    </>
  );
}

/** Top of the sidebar: what the battery agent recommends (or plans, in the forecast part) for the hour on the timeline. */
function SuggestedAction({ onOpenAlarms }: { onOpenAlarms: () => void }) {
  const hour = useSim((s) => s.snap?.hour ?? 0);
  const { time } = useViewMode();
  const forecast = time === 'forecast';
  useSim((s) => s.version);
  const alarms = useAlarms();
  const s = suggestion();
  if (!s) return null;
  const Icon = s.kind === 'charge' ? BatteryCharging : s.kind === 'discharge' ? BatteryMedium : PauseIco;
  const tone = s.kind === 'charge' ? 'var(--accent)' : s.kind === 'discharge' ? 'var(--warn)' : 'var(--muted)';
  const now = activeAt(alarms, hour);
  return (
    <section className="border-b border-[var(--border)] px-5 py-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="eyebrow">{forecast ? 'Planned action' : 'Suggested action'}</span>
        <span className={`badge ${time === 'live' ? 'badge-ok' : forecast ? 'badge-fc' : 'badge-hist'}`}>{time}</span>
      </div>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[var(--surface-2)]" style={{ color: tone }}>
          <Icon size={19} />
        </div>
        <div className="min-w-0">
          <div className="text-[15.5px] font-semibold leading-snug">
            {s.title}
            {s.kw > 5 && (
              <span className="tnum ml-1.5" style={{ color: tone }}>
                {fmtKw(s.kw)}
              </span>
            )}
          </div>
          <p className="mt-1 text-[12.5px] leading-snug muted">{s.why}</p>
        </div>
      </div>
      {s.capacityKwh > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] muted">
            <span>Battery charge</span>
            <span className="tnum">{(s.soc * 100).toFixed(0)}% of {(s.capacityKwh / 1000).toFixed(1)} MWh</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[var(--surface-3)]">
            <div className="h-full rounded-full bg-[var(--accent)]" style={{ width: `${s.soc * 100}%` }} />
          </div>
          {s.next && <div className="mt-2 text-[12px] muted">Next: {s.next}</div>}
        </div>
      )}
      {now.length > 0 && (
        <button type="button" onClick={onOpenAlarms} className="mt-3 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px]" style={{ background: now.some((a) => a.severity === 'critical') ? 'var(--danger-soft)' : 'var(--warn-soft)' }}>
          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: now.some((a) => a.severity === 'critical') ? 'var(--danger)' : 'var(--warn)' }} />
          <span className="truncate">{now.length} active alarm{now.length > 1 ? 's' : ''}: {now[0].title}</span>
        </button>
      )}
    </section>
  );
}

/** Right-hand sidebar (toggle from the header): suggested action + a chat about the campus at the selected time. */
export default function Assistant({ onOpenAlarms, onClose, pending, onPendingDone }: { onOpenAlarms: () => void; onClose: () => void; pending: string | null; onPendingDone: () => void }) {
  const ready = useSim((s) => s.snap !== null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // greeting once the data is in
  useEffect(() => {
    if (ready && msgs.length === 0) {
      setMsgs((m) => (m.length ? m : [{ role: 'bot', text: `Hi! I'm the Campus Nord energy assistant. Ask me about any moment of the week — the map and the timeline show **${hourLabel(useSim.getState().snap!.hour)}**.`, stream: true }]));
    }
  }, [ready, msgs.length]);

  // a question handed over from another panel (e.g. "Ask the assistant about this building")
  useEffect(() => {
    if (!ready || !pending) return;
    send(pending);
    onPendingDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending, ready]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  const scrollDown = useCallback(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight }), []);

  function send(text: string) {
    const q = text.trim();
    if (!q) return;
    const a = ask(q);
    if (a.goTo != null) useSim.getState().setTMin(a.goTo);
    setMsgs((m) => [...m, { role: 'user', text: q }, { role: 'bot', text: a.text, stream: true }]);
    setInput('');
  }

  return (
    <aside className="fade-in flex h-full w-full flex-col border-l border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-2.5">
        <span className="eyebrow">Assistant</span>
        <div className="flex items-center gap-2">
          {msgs.length > 1 && (
            <button type="button" className="text-[12px] muted hover:text-[var(--accent)]" onClick={() => setMsgs([])}>
              Clear
            </button>
          )}
          <button type="button" className="icon-btn !h-7 !w-7" onClick={onClose} aria-label="Hide assistant" title="Hide assistant">
            <PanelRightClose size={14} />
          </button>
        </div>
      </div>

      <SuggestedAction onOpenAlarms={onOpenAlarms} />

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="max-w-[85%] self-end rounded-lg rounded-br-sm bg-[var(--accent)] px-3 py-2 text-[13px] leading-snug text-[var(--on-accent)]">
              {m.text}
            </div>
          ) : (
            <div key={i} className="max-w-[92%] self-start rounded-lg rounded-bl-sm bg-[var(--surface-2)] px-3 py-2 text-[13px] leading-relaxed">
              {m.stream ? <StreamedReply text={m.text} onTick={scrollDown} /> : <Rich text={m.text} />}
            </div>
          ),
        )}
      </div>

      <div className={`flex gap-1.5 px-5 pb-2 ${msgs.length > 1 ? 'overflow-x-auto whitespace-nowrap' : 'flex-wrap'}`}>
        {CHIPS.map((c) => (
          <button key={c} type="button" className="chip" onClick={() => send(c)}>
            {c}
          </button>
        ))}
      </div>

      <form
        className="m-4 mt-1 flex items-center gap-2 rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] py-1 pl-3 pr-1 focus-within:border-[var(--accent)]"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about prices, alarms, a building, a day…"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] outline-none placeholder:text-[var(--faint)]"
          aria-label="Ask the assistant"
        />
        <button type="submit" className="flex h-8 w-8 items-center justify-center rounded-md bg-[var(--accent)] text-[var(--on-accent)] disabled:opacity-40" disabled={!input.trim()} aria-label="Send">
          <ArrowUp size={16} />
        </button>
      </form>
    </aside>
  );
}
