/**
 * InsightChart — thin wrapper around Recharts for consistent dashboard charts.
 * Keeps charts compact, operational, and visually consistent.
 */
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, PieChart, Pie, Legend,
} from 'recharts'
import { getAxisStyle, getGridStyle, getTooltipStyle, getChartColor } from '@/components/ui/chart'
import { cn } from '@/lib/utils'

type ChartType = 'bar' | 'line' | 'area' | 'donut'

interface DataPoint {
  [key: string]: string | number
}

interface InsightChartProps {
  type: ChartType
  data: DataPoint[]
  /** Key for X axis (category) */
  xKey: string
  /** Key(s) for data values */
  yKeys: Array<{ key: string; label?: string; color?: string }>
  height?: number
  className?: string
  /** Hide X axis labels — for very compact charts */
  hideXAxis?: boolean
}

const COLORS = ['chart1', 'chart2', 'chart3', 'chart4', 'chart5']

export function InsightChart({
  type, data, xKey, yKeys, height = 160, className, hideXAxis,
}: InsightChartProps) {
  const axisStyle = getAxisStyle()
  const gridStyle = getGridStyle()
  const tooltipStyle = getTooltipStyle()

  if (!data || data.length === 0) {
    return (
      <div
        className={cn('flex items-center justify-center bg-muted/20 rounded-lg', className)}
        style={{ height }}
      >
        <p className="text-xs text-muted-foreground">No data</p>
      </div>
    )
  }

  const commonProps = {
    data,
    margin: { top: 4, right: 4, left: -24, bottom: 0 },
  }

  if (type === 'donut') {
    return (
      <div className={className} style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey={yKeys[0]?.key ?? 'value'}
              nameKey={xKey}
              cx="50%"
              cy="50%"
              outerRadius={height / 2 - 20}
              innerRadius={height / 4}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={getChartColor(COLORS[i % COLORS.length])} />
              ))}
            </Pie>
            <Tooltip contentStyle={tooltipStyle} />
            <Legend
              iconSize={8}
              formatter={(v) => <span className="text-[10px] text-muted-foreground">{v}</span>}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
    )
  }

  return (
    <div className={className} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        {type === 'bar' ? (
          <BarChart {...commonProps}>
            <CartesianGrid {...gridStyle} />
            {!hideXAxis && <XAxis dataKey={xKey} {...axisStyle} />}
            <YAxis {...axisStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            {yKeys.map((yk, i) => (
              <Bar
                key={yk.key}
                dataKey={yk.key}
                name={yk.label ?? yk.key}
                fill={yk.color ? getChartColor(yk.color) : getChartColor(COLORS[i])}
                radius={[3, 3, 0, 0]}
              />
            ))}
          </BarChart>
        ) : type === 'area' ? (
          <AreaChart {...commonProps}>
            <CartesianGrid {...gridStyle} />
            {!hideXAxis && <XAxis dataKey={xKey} {...axisStyle} />}
            <YAxis {...axisStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            {yKeys.map((yk, i) => (
              <Area
                key={yk.key}
                dataKey={yk.key}
                name={yk.label ?? yk.key}
                stroke={yk.color ? getChartColor(yk.color) : getChartColor(COLORS[i])}
                fill={yk.color ? getChartColor(yk.color) : getChartColor(COLORS[i])}
                fillOpacity={0.1}
                strokeWidth={1.5}
              />
            ))}
          </AreaChart>
        ) : (
          <LineChart {...commonProps}>
            <CartesianGrid {...gridStyle} />
            {!hideXAxis && <XAxis dataKey={xKey} {...axisStyle} />}
            <YAxis {...axisStyle} />
            <Tooltip contentStyle={tooltipStyle} />
            {yKeys.map((yk, i) => (
              <Line
                key={yk.key}
                dataKey={yk.key}
                name={yk.label ?? yk.key}
                stroke={yk.color ? getChartColor(yk.color) : getChartColor(COLORS[i])}
                strokeWidth={1.5}
                dot={false}
              />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  )
}
