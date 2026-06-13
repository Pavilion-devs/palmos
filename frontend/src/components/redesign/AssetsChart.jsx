import {
  Area,
  AreaChart,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { assetsUnderControl, formatUsd } from './data/selectors'

function compactUsd(n) {
  const v = Number(n) || 0
  if (Math.abs(v) >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (Math.abs(v) >= 1_000) return `$${(v / 1_000).toFixed(1)}k`
  return `$${v.toFixed(0)}`
}

function ChartTooltip({ active, payload }) {
  if (!active || !payload || payload.length === 0) return null
  return (
    <div className="rounded-lg border border-hairline bg-panel-2 px-3 py-2 font-mono text-xs text-foreground shadow-lg">
      {formatUsd(payload[0].value)}
    </div>
  )
}

export function AssetsChart({ agents = [], historyStatus = 'loading', series = [] }) {
  const auc = assetsUnderControl(agents)

  const data = series.map((point) => ({
    label: new Date(point.at).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    }),
    value: point.valueUsd,
  }))
  const hasChart = data.length >= 2

  return (
    <section className="rounded-3xl bg-panel p-6">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Assets under control over time
          </h2>
          <p className="font-mono text-xs text-muted-foreground">
            Across all agent wallets · USD
          </p>
        </div>
        <p className="font-mono text-2xl font-semibold tracking-tight text-foreground">
          {formatUsd(auc)}
        </p>
      </div>

      <div className="mt-6 h-[240px] w-full">
        {hasChart ? (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 10, right: 8, left: 8, bottom: 0 }}>
              <defs>
                <linearGradient id="limeFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#C6F94E" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="#C6F94E" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#232823" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fill: '#9AA39F', fontSize: 11, fontFamily: 'ui-monospace' }}
                tickLine={false}
                axisLine={{ stroke: '#232823' }}
                minTickGap={24}
              />
              <YAxis
                tick={{ fill: '#9AA39F', fontSize: 11, fontFamily: 'ui-monospace' }}
                tickLine={false}
                axisLine={false}
                width={52}
                tickFormatter={compactUsd}
                domain={['auto', 'auto']}
              />
              <Tooltip
                cursor={{ stroke: '#C6F94E', strokeWidth: 1, strokeDasharray: '4 4' }}
                content={<ChartTooltip />}
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="#C6F94E"
                strokeWidth={2.5}
                fill="url(#limeFill)"
                isAnimationActive={false}
                dot={false}
                activeDot={{ r: 4, fill: '#C6F94E', stroke: '#0A0B0A', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-hairline">
            <p className="max-w-sm px-6 text-center text-sm text-muted-foreground">
              {historyStatus === 'loading'
                ? 'Loading…'
                : agents.length === 0
                  ? 'Connect an agent to start tracking assets under control over time.'
                  : 'Portfolio history populates here as snapshots are captured.'}
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
