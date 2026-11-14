import { useMemo } from 'react';
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis, Bar } from 'recharts';
import { derived, useSim } from '../store/useSim';
import { clockAt, dayLabelAt } from '../lib/format';

/** Week charts: power balance, battery state, and the price / CO₂ the agent is reacting to. */
export default function Dashboard() {
  const version = useSim((s) => s.version);
  const tMin = useSim((s) => s.tMin);
  const d = derived.current;
  const rows = useMemo(() => {
    if (!d) return [];
    return Array.from({ length: 168 }, (_, h) => ({
      h,
      label: `${dayLabelAt(d.startMs, h * 60).split(' ')[0]} ${clockAt(d.startMs, h * 60)}`,
      load: d.week.load[h] / 1000,
      solar: d.pvTot[h] / 1000,
      base: d.chosen.baseGrid[h] / 1000,
      grid: d.chosen.grid[h] / 1000,
      soc: (d.chosen.socEnd[h] / Math.max(1, d.chosen.socEnd.reduce((a, b) => Math.max(a, b), 1))) * 100,
      batt: d.chosen.sp[h] / 1000,
      price: d.week.price[h],
      co2: d.week.co2[h],
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version, d?.week.start]);
  const cursor = tMin / 60;
  const tick = { fill: '#8da0d8', fontSize: 10, fontWeight: 700 };
  const common = { data: rows, margin: { top: 6, right: 8, left: -14, bottom: 0 } };
  const x = <XAxis dataKey="h" tick={tick} tickFormatter={(h) => (h % 24 === 0 ? dayLabelAt(d?.startMs ?? 0, h * 60).split(' ')[0] : '')} interval={0} axisLine={false} tickLine={false} />;

  return (
    <div className="grid h-full grid-cols-3 gap-3">
      <Card title="⚡ Power balance (MW)">
        <ComposedChart {...common}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          {x}
          <YAxis tick={tick} axisLine={false} tickLine={false} />
          <Tooltip labelFormatter={(h) => rows[Number(h)]?.label} formatter={(v) => Number(v).toFixed(2)} />
          <Area dataKey="load" name="Load" stroke="#ff6b8a" fill="#ff6b8a33" strokeWidth={2} dot={false} />
          <Area dataKey="solar" name="Solar" stroke="#ffc83d" fill="#ffc83d55" strokeWidth={2} dot={false} />
          <Line dataKey="base" name="Grid · no battery" stroke="#8da0d8" strokeDasharray="4 3" strokeWidth={1.5} dot={false} />
          <Line dataKey="grid" name="Grid · with agent" stroke="#5cc8ff" strokeWidth={2.4} dot={false} />
          <ReferenceLine x={cursor} stroke="#fff" strokeWidth={2} />
        </ComposedChart>
      </Card>
      <Card title="🔋 Battery (MW + / − · charge level)">
        <ComposedChart {...common}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          {x}
          <YAxis yAxisId="a" tick={tick} axisLine={false} tickLine={false} />
          <YAxis yAxisId="b" orientation="right" domain={[0, 100]} hide />
          <Tooltip labelFormatter={(h) => rows[Number(h)]?.label} formatter={(v) => Number(v).toFixed(2)} />
          <Area yAxisId="b" dataKey="soc" name="Charge level %" stroke="#ab8cff" fill="#ab8cff30" strokeWidth={2} dot={false} />
          <Bar yAxisId="a" dataKey="batt" name="Setpoint MW" fill="#ffb627" />
          <ReferenceLine yAxisId="a" x={cursor} stroke="#fff" strokeWidth={2} />
        </ComposedChart>
      </Card>
      <Card title="💶 Price (€/kWh) & 🌍 CO₂ (kg/kWh)">
        <ComposedChart {...common}>
          <CartesianGrid stroke="#ffffff12" vertical={false} />
          {x}
          <YAxis yAxisId="a" tick={tick} axisLine={false} tickLine={false} />
          <YAxis yAxisId="b" orientation="right" hide />
          <Tooltip labelFormatter={(h) => rows[Number(h)]?.label} formatter={(v) => Number(v).toFixed(3)} />
          <Line yAxisId="a" dataKey="price" name="Price" stroke="#6fd3ff" strokeWidth={2} dot={false} />
          <Line yAxisId="b" dataKey="co2" name="CO₂" stroke="#7dffb0" strokeWidth={2} dot={false} />
          <ReferenceLine yAxisId="a" x={cursor} stroke="#fff" strokeWidth={2} />
        </ComposedChart>
      </Card>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactElement }) {
  return (
    <div className="panel-flat flex min-h-0 flex-col p-2.5">
      <div className="mb-1 text-[12px] font-black text-white">{title}</div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">{children}</ResponsiveContainer>
      </div>
    </div>
  );
}
