import { Fragment, useEffect, useRef, useState } from 'react';
import { ArrowUp, BatteryCharging, BatteryMedium, Pause as PauseIco } from 'lucide-react';
import { useSim } from '../store/useSim';
import { ask, hourLabel, suggestion } from '../lib/assistant';
import { fmtKw } from '../lib/format';

interface Msg {
  role: 'user' | 'bot';
  text: string;
}

const CHIPS = ['What should we do now?', 'Cheapest hour in the next 24 h?', 'Which buildings use most?', 'How does today compare to yesterday?', 'How much have we saved?'];

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

/** Top of the sidebar: what the battery agent recommends for the hour on the timeline. */
function SuggestedAction() {
  useSim((s) => s.snap?.hour);
  useSim((s) => s.version);
  const s = suggestion();
  if (!s) return null;
  const Icon = s.kind === 'charge' ? BatteryCharging : s.kind === 'discharge' ? BatteryMedium : PauseIco;
  const tone = s.kind === 'charge' ? 'text-[#007bc0]' : s.kind === 'discharge' ? 'text-[#c2410c]' : 'text-[#5f6368]';
  return (
    <section className="border-b border-[#e3e6ea] px-5 py-4">
      <div className="eyebrow mb-2">Suggested action</div>
      <div className="flex items-start gap-3">
        <div className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#f1f3f5] ${tone}`}>
          <Icon size={20} />
        </div>
        <div className="min-w-0">
          <div className="text-[16px] font-semibold leading-snug text-[#1d1d1b]">
            {s.title}
            {s.kw > 5 && <span className={`tnum ml-1.5 ${tone}`}>{fmtKw(s.kw)}</span>}
          </div>
          <p className="mt-1 text-[13px] leading-snug text-[#5f6368]">{s.why}</p>
        </div>
      </div>
      {s.capacityKwh > 0 && (
        <div className="mt-3">
          <div className="mb-1 flex justify-between text-[11px] text-[#5f6368]">
            <span>Battery charge</span>
            <span className="tnum">{(s.soc * 100).toFixed(0)}% of {(s.capacityKwh / 1000).toFixed(1)} MWh</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-[#e3e6ea]">
            <div className="h-full rounded-full bg-[#007bc0]" style={{ width: `${s.soc * 100}%` }} />
          </div>
          {s.next && <div className="mt-2 text-[12px] text-[#5f6368]">Next: {s.next}</div>}
        </div>
      )}
    </section>
  );
}

/** Right-hand sidebar: suggested action + a chat about the campus at the selected time. */
export default function Assistant() {
  const ready = useSim((s) => s.snap !== null);
  const selection = useSim((s) => s.selection);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // greeting once the data is in
  useEffect(() => {
    if (ready && msgs.length === 0) {
      setMsgs((m) => (m.length ? m : [{ role: 'bot', text: `Hi! I'm the Campus Nord energy assistant. Ask me about any moment of the week — the map and the timeline show **${hourLabel(useSim.getState().snap!.hour)}**.` }]));
    }
  }, [ready, msgs.length]);

  // clicking a building on the map asks about it
  useEffect(() => {
    if (!selection) return;
    const p = useSim.getState().campus?.features.find((f) => f.properties.osmId === selection)?.properties;
    if (p) send(`Tell me about ${p.short}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selection]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [msgs]);

  function send(text: string) {
    const q = text.trim();
    if (!q) return;
    const a = ask(q);
    if (a.goTo != null) useSim.getState().setTMin(a.goTo);
    setMsgs((m) => [...m, { role: 'user', text: q }, { role: 'bot', text: a.text }]);
    setInput('');
  }

  return (
    <aside className="flex h-full w-[380px] shrink-0 flex-col border-l border-[#e3e6ea] bg-white">
      <SuggestedAction />

      <div className="flex items-center justify-between px-5 pb-1 pt-4">
        <div className="eyebrow">Assistant</div>
        {msgs.length > 1 && (
          <button type="button" className="text-[12px] text-[#5f6368] hover:text-[#007bc0]" onClick={() => setMsgs([])}>
            Clear
          </button>
        )}
      </div>

      <div ref={listRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-5 py-3">
        {msgs.map((m, i) =>
          m.role === 'user' ? (
            <div key={i} className="max-w-[85%] self-end rounded-lg rounded-br-sm bg-[#007bc0] px-3 py-2 text-[13px] leading-snug text-white">
              {m.text}
            </div>
          ) : (
            <div key={i} className="max-w-[92%] self-start rounded-lg rounded-bl-sm bg-[#f1f3f5] px-3 py-2 text-[13px] leading-relaxed text-[#1d1d1b]">
              <Rich text={m.text} />
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
        className="m-4 mt-1 flex items-center gap-2 rounded-lg border border-[#d0d4da] bg-white py-1 pl-3 pr-1 focus-within:border-[#007bc0]"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about prices, buildings, a day or hour…"
          className="min-w-0 flex-1 bg-transparent py-1.5 text-[13px] text-[#1d1d1b] outline-none placeholder:text-[#80868b]"
          aria-label="Ask the assistant"
        />
        <button type="submit" className="flex h-8 w-8 items-center justify-center rounded-md bg-[#007bc0] text-white disabled:opacity-40" disabled={!input.trim()} aria-label="Send">
          <ArrowUp size={16} />
        </button>
      </form>
    </aside>
  );
}
