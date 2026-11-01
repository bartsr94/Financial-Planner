import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

/** One bar series: a label for the legend and tooltip, a CSS colour, and one value per month. */
export interface Series { key: string; label: string; color: string; values: number[] }

export function monthLabel(month: string, withYear = false): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', withYear ? { month: 'short', year: 'numeric' } : { month: 'short' });
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

/** 1, 2, 2.5 or 5 times a power of ten, so the grid lands on round numbers. */
function niceStep(range: number, ticks: number): number {
  const raw = range / ticks || 1;
  const pow = 10 ** Math.floor(Math.log10(raw));
  return ([1, 2, 2.5, 5, 10].find((n) => n * pow >= raw) ?? 10) * pow;
}

const compact = new Intl.NumberFormat('en-GB', { notation: 'compact', maximumFractionDigits: 1 });

/** A bar with 4px rounded corners on its outer end only; `up` false rounds the bottom (negative values). */
function barPath(x: number, y: number, w: number, h: number, up: boolean, round = true): string {
  const r = round ? Math.min(4, w / 2, h) : 0;
  if (h <= 0) return '';
  return up
    ? `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
    : `M${x},${y}V${y + h - r}Q${x},${y + h} ${x + r},${y + h}H${x + w - r}Q${x + w},${y + h} ${x + w},${y + h - r}V${y}Z`;
}

interface BarChartProps {
  months: string[];
  series: Series[];
  stacked?: boolean;
  height?: number;
  format: (n: number) => string;
  selected?: number;
  onSelect?: (i: number) => void;
  /** per-bar colour override, for a single series that is coloured by sign */
  colorOf?: (value: number) => string;
  /** extra lines under the series values in the tooltip */
  tooltipExtra?: (i: number) => ReactNode;
}

/** Grouped or stacked monthly bars with a recessive grid, hover tooltip and optional click-to-select month. */
export function BarChart({ months, series, stacked, height = 240, format, selected, onSelect, colorOf, tooltipExtra }: BarChartProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = months.length;
  const totals = months.map((_, i) => series.reduce((t, s) => t + Math.max(0, s.values[i] ?? 0), 0));
  const values = series.flatMap((s) => s.values);
  const max = Math.max(0, ...(stacked ? totals : values));
  const min = Math.min(0, ...values);
  const step = niceStep(max - min, 4);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.floor(min / step) * step;

  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const y = (v: number) => pad.t + ((top - v) / (top - bottom)) * plotH;
  const band = n ? plotW / n : 0;
  const groupW = Math.min(band * 0.72, stacked ? 44 : 64);
  const k = stacked ? 1 : series.length;
  const barW = Math.max(2, (groupW - 2 * (k - 1)) / k);
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);
  const labelEvery = Math.ceil(n / Math.max(1, Math.floor(plotW / 44)));

  const tipLeft = hover === null ? 0 : pad.l + band * (hover + 0.5);
  return (
    <div className="chart" ref={wrapRef} style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(' and ') + ' by month'}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'gridline'} />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{compact.format(t)}</text>
            </g>
          ))}
          {months.map((m, i) => {
            const x0 = pad.l + band * i + (band - groupW) / 2;
            const showLabel = i % labelEvery === 0 || i === n - 1;
            const firstOfYear = i === 0 || m.endsWith('-01');
            let stackTop = 0;
            let lastNonZero = -1;
            series.forEach((s, si) => { if ((s.values[i] ?? 0) > 0) lastNonZero = si; });
            return (
              <g key={m}>
                {(hover === i || selected === i) && (
                  <rect x={pad.l + band * i + 1} y={pad.t} width={band - 2} height={plotH} rx={6}
                    className={selected === i ? 'band selected' : 'band'} />
                )}
                {series.map((s, si) => {
                  const v = s.values[i] ?? 0;
                  const fill = colorOf ? colorOf(v) : s.color;
                  if (stacked) {
                    if (v <= 0) return null;
                    const y1 = y(stackTop + v), y0 = y(stackTop);
                    stackTop += v;
                    // 2px surface gap between segments; only the top segment gets rounded corners
                    const h = Math.max(0, y0 - y1 - (si === 0 ? 0 : 2));
                    return <path key={s.key} d={barPath(x0, y1, groupW, h, true, si === lastNonZero)} fill={fill} />;
                  }
                  const xb = x0 + si * (barW + 2);
                  return v >= 0
                    ? <path key={s.key} d={barPath(xb, y(v), barW, y(0) - y(v), true)} fill={fill} />
                    : <path key={s.key} d={barPath(xb, y(0), barW, y(v) - y(0), false)} fill={fill} />;
                })}
                {showLabel && (
                  <text x={pad.l + band * (i + 0.5)} y={height - 8} textAnchor="middle" className={selected === i ? 'tick strong' : 'tick'}>
                    {monthLabel(m)}{firstOfYear && n > 1 ? ` ’${m.slice(2, 4)}` : ''}
                  </text>
                )}
                <rect x={pad.l + band * i} y={0} width={band} height={height} fill="transparent"
                  style={{ cursor: onSelect ? 'pointer' : 'default' }}
                  onMouseEnter={() => setHover(i)} onClick={() => onSelect?.(i)} />
              </g>
            );
          })}
        </svg>
      )}
      {hover !== null && (
        <div className="tooltip" style={{ left: tipLeft, transform: tipLeft > width * 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
          <div className="tt-title">{monthLabel(months[hover], true)}</div>
          {(stacked ? [...series].reverse() : series).filter((s) => !stacked || (s.values[hover] ?? 0) > 0).map((s) => (
            <div className="tt-row" key={s.key}>
              <span className="swatch" style={{ background: colorOf ? colorOf(s.values[hover] ?? 0) : s.color }} />
              <span>{s.label}</span><b>{format(s.values[hover] ?? 0)}</b>
            </div>
          ))}
          {stacked && <div className="tt-row total"><span /><span>Total</span><b>{format(totals[hover])}</b></div>}
          {tooltipExtra?.(hover)}
          {onSelect && <div className="tt-hint">Click to see this month</div>}
        </div>
      )}
    </div>
  );
}

export function Legend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="legend">
      {items.map((i) => <span key={i.label}><span className="swatch" style={{ background: i.color }} />{i.label}</span>)}
    </div>
  );
}

/** A small trend line for a stat tile; draws nothing with fewer than two points. */
export function Sparkline({ values, color = 'var(--series-1)' }: { values: number[]; color?: string }) {
  if (values.length < 2) return null;
  const w = 120, h = 32, lo = Math.min(...values), hi = Math.max(...values), span = hi - lo || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (w - 4) + 2},${h - 3 - ((v - lo) / span) * (h - 6)}`);
  return (
    <svg className="spark" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts.at(-1)!.split(',')[0]} cy={pts.at(-1)!.split(',')[1]} r={3} fill={color} />
    </svg>
  );
}

/** One line: values per month, null where nothing is known yet (the line starts at its first value). */
export interface LineSeries { key: string; label: string; color: string; values: (number | null)[] }

interface LineChartProps {
  months: string[];
  series: LineSeries[];
  height?: number;
  format: (n: number) => string;
  /** false fits the axis to the data, so a large value that moves a little shows its movement */
  zeroBased?: boolean;
  /** extra lines under the series values in the tooltip */
  tooltipExtra?: (i: number) => ReactNode;
}

/** Monthly lines on one axis, with a crosshair and a tooltip listing every series at the hovered month. */
export function LineChart({ months, series, height = 260, format, zeroBased = true, tooltipExtra }: LineChartProps) {
  const [wrapRef, width] = useWidth<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);

  const n = months.length;
  const values = series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const max = Math.max(...(zeroBased ? [0] : []), ...values), min = Math.min(...(zeroBased ? [0] : []), ...values);
  const step = niceStep(max - min, 4);
  const top = Math.ceil(max / step) * step || step;
  const bottom = Math.min(Math.floor(min / step) * step, top - step);

  const pad = { l: 44, r: 12, t: 10, b: 26 };
  const plotW = Math.max(0, width - pad.l - pad.r);
  const plotH = height - pad.t - pad.b;
  const x = (i: number) => pad.l + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const y = (v: number) => pad.t + ((top - v) / (top - bottom)) * plotH;
  const ticks: number[] = [];
  for (let v = bottom; v <= top + step / 2; v += step) ticks.push(v);
  const labelEvery = Math.ceil(n / Math.max(1, Math.floor(plotW / 44)));

  function onMove(e: ReactMouseEvent<SVGRectElement>) {
    const box = e.currentTarget.getBoundingClientRect();
    const i = n > 1 ? Math.round(((e.clientX - box.left) / box.width) * (n - 1)) : 0;
    setHover(Math.max(0, Math.min(n - 1, i)));
  }

  const tipLeft = hover === null ? 0 : x(hover);
  return (
    <div className="chart" ref={wrapRef} style={{ height }} onMouseLeave={() => setHover(null)}>
      {width > 0 && n > 0 && (
        <svg width={width} height={height} role="img" aria-label={series.map((s) => s.label).join(', ') + ' by month'}>
          {ticks.map((t) => (
            <g key={t}>
              <line x1={pad.l} x2={width - pad.r} y1={y(t)} y2={y(t)} className={t === 0 ? 'axis' : 'gridline'} />
              <text x={pad.l - 8} y={y(t)} dy="0.32em" textAnchor="end" className="tick">{compact.format(t)}</text>
            </g>
          ))}
          {months.map((m, i) => (i % labelEvery === 0 || i === n - 1) && (
            <text key={m} x={x(i)} y={height - 8} textAnchor="middle" className={hover === i ? 'tick strong' : 'tick'}>
              {monthLabel(m)}{(i === 0 || m.endsWith('-01')) && n > 1 ? ` ’${m.slice(2, 4)}` : ''}
            </text>
          ))}
          {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + plotH} className="crosshair" />}
          {series.map((s) => {
            const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
            return <polyline key={s.key} points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />;
          })}
          {hover === null && series.map((s) => s.values.at(-1) != null && (
            <circle key={s.key} cx={x(n - 1)} cy={y(s.values.at(-1)!)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
          ))}
          {hover !== null && series.map((s) => s.values[hover] !== null && (
            <circle key={s.key} cx={x(hover)} cy={y(s.values[hover]!)} r={4} fill={s.color} stroke="var(--card)" strokeWidth={2} />
          ))}
          <rect x={pad.l} y={0} width={plotW} height={height} fill="transparent" onMouseMove={onMove} />
        </svg>
      )}
      {hover !== null && (
        <div className="tooltip" style={{ left: tipLeft, transform: tipLeft > width * 0.6 ? 'translateX(calc(-100% - 12px))' : 'translateX(12px)' }}>
          <div className="tt-title">{monthLabel(months[hover], true)}</div>
          {series.map((s) => (
            <div className="tt-row" key={s.key}>
              <span className="swatch" style={{ background: s.color }} />
              <span>{s.label}</span><b>{s.values[hover] === null ? '–' : format(s.values[hover]!)}</b>
            </div>
          ))}
          {tooltipExtra?.(hover)}
        </div>
      )}
    </div>
  );
}
