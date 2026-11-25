// Dependency-free SVG charts fed with real on-chain data.
import { useEffect, useRef, useState } from "react";

export const CHART_COLORS = ["#1e9bff", "#3ccf6e", "#f5b400", "#ff5c5c", "#8b6cf6", "#19c6ff", "#ff8a3d"];

/**
 * Ring chart with gapped segments, centre label and a legend table.
 * data: [{ label, value, color }]
 */
export function Donut({ data, centerLabel, format = (v) => v, size = 180, thickness = 16 }) {
  const total = data.reduce((a, d) => a + d.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  const gap = total > 0 && data.filter((d) => d.value > 0).length > 1 ? 6 : 0;
  let offset = 0;
  const top = [...data].sort((a, b) => b.value - a.value)[0];
  const pct = (v) => (total ? (v / total) * 100 : 0);

  return (
    <div className="donut">
      <div className="donut-ring" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#1a2236" strokeWidth={thickness} />
          {total > 0 &&
            data.map((d) => {
              const len = (d.value / total) * c;
              const seg = Math.max(len - gap, 0);
              const el =
                d.value > 0 ? (
                  <circle
                    key={d.label}
                    cx={size / 2}
                    cy={size / 2}
                    r={r}
                    fill="none"
                    stroke={d.color}
                    strokeWidth={thickness}
                    strokeDasharray={`${seg} ${c - seg}`}
                    strokeDashoffset={-offset}
                    strokeLinecap={gap ? "round" : "butt"}
                    transform={`rotate(-90 ${size / 2} ${size / 2})`}
                  >
                    <title>{`${d.label}: ${format(d.value)}`}</title>
                  </circle>
                ) : null;
              offset += len;
              return el;
            })}
        </svg>
        <div className="donut-center">
          {total > 0 ? (
            <>
              <b style={{ color: top.color }}>{pct(top.value).toFixed(2)}%</b>
              <span>{centerLabel || top.label}</span>
            </>
          ) : (
            <span>No data yet</span>
          )}
        </div>
      </div>
      <ul className="legend">
        {data.map((d) => (
          <li key={d.label}>
            <span className="dot" style={{ background: d.color }} />
            <span className="legend-label">{d.label}</span>
            <span className="legend-val">{format(d.value)}</span>
            <span className="legend-pct">{pct(d.value).toFixed(2)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(800);
  useEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return [1, 2, 2.5, 5, 10].map((m) => m * p).find((m) => m >= v);
};

/**
 * Stepped cumulative area chart with hover tooltip.
 * points: [{ t: unixSeconds, v: number, note?: string }] sorted by t
 */
export function AreaChart({ points, color = "#3ccf6e", height = 280, format = (v) => v, emptyText = "No activity yet" }) {
  const [ref, width] = useWidth();
  const [hover, setHover] = useState(null);
  const pad = { l: 12, r: 56, t: 16, b: 28 };
  const W = width, H = height;
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;

  if (!points.length) {
    return (
      <div ref={ref} className="chart-empty" style={{ height }}>
        {emptyText}
      </div>
    );
  }
  // extend to "now" so the step continues to the right edge
  const now = Math.floor(Date.now() / 1000);
  const pts = [...points, { t: Math.max(now, points[points.length - 1].t), v: points[points.length - 1].v, ghost: true }];
  const t0 = pts[0].t, t1 = pts[pts.length - 1].t === t0 ? t0 + 1 : pts[pts.length - 1].t;
  const vmax = niceMax(Math.max(...pts.map((p) => p.v)));
  const x = (t) => pad.l + ((t - t0) / (t1 - t0)) * iw;
  const y = (v) => pad.t + ih - (v / vmax) * ih;

  let d = `M${x(pts[0].t)},${y(0)} L${x(pts[0].t)},${y(pts[0].v)}`;
  for (let i = 1; i < pts.length; i++) d += ` L${x(pts[i].t)},${y(pts[i - 1].v)} L${x(pts[i].t)},${y(pts[i].v)}`;
  const area = `${d} L${x(pts[pts.length - 1].t)},${y(0)} Z`;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * vmax);
  const nx = W < 520 ? 3 : 6; // fewer labels on narrow screens
  const xticks = Array.from({ length: nx }, (_, i) => t0 + ((t1 - t0) * i) / (nx - 1));
  const span = t1 - t0;
  const fmtT = (t) => {
    const dt = new Date(t * 1000);
    return span < 2 * 86400 ? dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : dt.toLocaleDateString([], { month: "short", day: "numeric" });
  };

  function onMove(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const t = t0 + ((mx - pad.l) / iw) * (t1 - t0);
    let idx = 0;
    for (let i = 0; i < points.length; i++) if (points[i].t <= t) idx = i;
    setHover({ p: points[idx], mx: Math.min(Math.max(mx, pad.l), pad.l + iw) });
  }

  const gid = `g${color.replace("#", "")}`;
  return (
    <div ref={ref} className="area-chart">
      <svg width={W} height={H} onMouseMove={onMove} onMouseLeave={() => setHover(null)}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.35" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {ticks.map((tv) => (
          <g key={tv}>
            <line x1={pad.l} x2={pad.l + iw} y1={y(tv)} y2={y(tv)} stroke="#1a2236" />
            <text x={W - pad.r + 8} y={y(tv) + 4} className="axis">{format(tv)}</text>
          </g>
        ))}
        {xticks.map((tv, i) => (
          <text key={i} x={x(tv)} y={H - 8} className="axis" textAnchor={i === 0 ? "start" : i === nx - 1 ? "end" : "middle"}>
            {fmtT(tv)}
          </text>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={d} fill="none" stroke={color} strokeWidth="2" />
        {points.map((p, i) => (
          <circle key={i} cx={x(p.t)} cy={y(p.v)} r="2.5" fill={color} />
        ))}
        {hover && (
          <g>
            <line x1={hover.mx} x2={hover.mx} y1={pad.t} y2={pad.t + ih} stroke="#56627a" strokeDasharray="3 3" />
            <circle cx={x(hover.p.t)} cy={y(hover.p.v)} r="5" fill="#0b0f1a" stroke={color} strokeWidth="2" />
          </g>
        )}
      </svg>
      {hover && (
        <div className="chart-tip" style={{ left: Math.min(hover.mx + 12, W - 210), top: 12 }}>
          <div className="tip-head">
            <span>{new Date(hover.p.t * 1000).toLocaleDateString()}</span>
            <span>{new Date(hover.p.t * 1000).toLocaleTimeString()}</span>
          </div>
          <div className="tip-row">
            <span className="dot" style={{ background: color }} /> Total <b>{format(hover.p.v)}</b>
          </div>
          {hover.p.note && <div className="tip-note">{hover.p.note}</div>}
        </div>
      )}
    </div>
  );
}
