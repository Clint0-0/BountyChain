import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams, Link } from "react-router-dom";
import { usePrograms } from "../lib/hooks";
import { programPhase, fmtEth } from "../lib/contract";
import { Loading, ErrorBox, Empty, PhaseBadge } from "../components/ui";
import Icon from "../components/icons";

const PAGE = 10;

// Filter presets shown as tiles (like the strategy picker in the template).
const FILTERS = [
  { id: "all", title: "All programs", desc: "Every program on the platform", icon: "grid", color: "#1e9bff", test: () => true },
  { id: "open", title: "Open now", desc: "Accepting reports right now", icon: "bolt", color: "#3ccf6e", test: (p) => programPhase(p) === "Open" },
  { id: "upcoming", title: "Upcoming", desc: "Start date in the future", icon: "calendar", color: "#19c6ff", test: (p) => programPhase(p) === "Upcoming" },
  { id: "top", title: "Top rewards", desc: "Critical tier of 1 ETH or more", icon: "trophy", color: "#f5b400", test: (p) => p.rewards[3] >= 10n ** 18n },
  { id: "funded", title: "Well funded", desc: "Pool covers the critical tier", icon: "wallet", color: "#8b6cf6", test: (p) => p.availableBalance >= p.rewards[3] },
  { id: "quiet", title: "No reports yet", desc: "Be the first to submit", icon: "flag", color: "#ff8a3d", test: (p) => p.submissionCount === 0 },
  { id: "closed", title: "Closed", desc: "Ended or deactivated", icon: "pause", color: "#ff5c5c", test: (p) => ["Ended", "Inactive"].includes(programPhase(p)) },
  { id: "watch", title: "Watchlist", desc: "Programs you starred", icon: "star", color: "#f5b400", test: (p, w) => w.includes(p.id) },
];

// Watchlist is a per-browser convenience only (not security relevant).
function loadWatch() {
  try {
    return JSON.parse(localStorage.getItem("bc_watchlist") || "[]");
  } catch {
    return [];
  }
}
function saveWatch(w) {
  try {
    localStorage.setItem("bc_watchlist", JSON.stringify(w));
  } catch {
    /* storage unavailable */
  }
}

export default function Programs() {
  const { data, loading, error } = usePrograms();
  const [params, setParams] = useSearchParams();
  const nav = useNavigate();
  const [filter, setFilter] = useState("open");
  const [draft, setDraft] = useState(params.get("q") || "");
  const [page, setPage] = useState(1);
  const [watch, setWatch] = useState(loadWatch);
  const q = params.get("q") || "";

  useEffect(() => {
    setDraft(q);
  }, [q]);
  useEffect(() => {
    setPage(1);
  }, [filter, q]);

  const list = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter);
    return (data || []).filter((p) => {
      if (!f.test(p, watch)) return false;
      const hay = `${p.title} ${p.meta?.organizationName || ""} ${p.meta?.description || ""} ${p.meta?.inScope || ""}`.toLowerCase();
      return hay.includes(q.toLowerCase());
    });
  }, [data, filter, q, watch]);

  const pages = Math.max(1, Math.ceil(list.length / PAGE));
  const rows = list.slice((page - 1) * PAGE, page * PAGE);
  const toggleWatch = (id) => {
    const w = watch.includes(id) ? watch.filter((x) => x !== id) : [...watch, id];
    setWatch(w);
    saveWatch(w);
  };

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-title center">Find a program that fits you</div>
        <div className="tiles">
          {FILTERS.map((f) => (
            <button key={f.id} className={`tile ${filter === f.id ? "active" : ""}`} onClick={() => setFilter(f.id)}>
              <span className="tile-icon" style={{ background: `${f.color}22`, color: f.color }}>
                <Icon name={f.icon} size={22} />
              </span>
              <span className="tile-title">{f.title}</span>
              <span className="tile-desc">{f.desc}</span>
            </button>
          ))}
        </div>
        <form
          className="filter-bar"
          onSubmit={(e) => {
            e.preventDefault();
            setParams(draft.trim() ? { q: draft.trim() } : {});
          }}
        >
          <div className="input-icon">
            <Icon name="search" size={16} />
            <input className="input" placeholder="Keyword: title, organization, scope…" value={draft} onChange={(e) => setDraft(e.target.value)} />
          </div>
          <button type="button" className="btn btn-link" onClick={() => { setDraft(""); setParams({}); setFilter("all"); }}>
            Clear all
          </button>
          <button className="btn btn-primary">Search</button>
        </form>
      </section>

      <section className="panel">
        <div className="panel-title center">
          Available programs <span className="muted">({list.length})</span>
        </div>
        <ErrorBox error={error} />
        {loading && !data ? (
          <Loading />
        ) : rows.length ? (
          <>
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Program</th>
                    <th>Organization</th>
                    <th>Status</th>
                    <th className="num">Reports</th>
                    <th className="num">Low</th>
                    <th className="num">Medium</th>
                    <th className="num">High</th>
                    <th className="num">Critical</th>
                    <th className="num">Pool available</th>
                    <th>Ends</th>
                    <th className="center">Watch</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id} className="clickable" onClick={() => nav(`/programs/${p.id}`)}>
                      <td>
                        <Link to={`/programs/${p.id}`} onClick={(e) => e.stopPropagation()}>
                          #{p.id} {p.title}
                        </Link>
                      </td>
                      <td>{p.meta?.organizationName || <span className="muted">—</span>}</td>
                      <td><PhaseBadge phase={programPhase(p)} /></td>
                      <td className="num">{p.submissionCount}</td>
                      {p.rewards.map((r, i) => (
                        <td key={i} className="num">{fmtEth(r, 3)}</td>
                      ))}
                      <td className={`num ${p.availableBalance >= p.rewards[3] ? "t-pos" : "t-warn"}`}>{fmtEth(p.availableBalance, 3)}</td>
                      <td className="muted">{new Date(p.endTime * 1000).toLocaleDateString()}</td>
                      <td className="center">
                        <button
                          className={`star ${watch.includes(p.id) ? "on" : ""}`}
                          title={watch.includes(p.id) ? "Remove from watchlist" : "Add to watchlist"}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleWatch(p.id);
                          }}
                        >
                          <Icon name="star" size={17} fill={watch.includes(p.id) ? "currentColor" : "none"} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager page={page} pages={pages} onPage={setPage} />
          </>
        ) : (
          <Empty title="No programs match" icon="search">
            {data?.length ? "Try another filter or clear the search." : "No organization has published a bounty program yet."}
          </Empty>
        )}
      </section>
    </div>
  );
}

export function Pager({ page, pages, onPage }) {
  if (pages <= 1) return null;
  const nums = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || Math.abs(i - page) <= 1) nums.push(i);
    else if (nums[nums.length - 1] !== "…") nums.push("…");
  }
  return (
    <div className="pager">
      <button className="pager-arrow" disabled={page === 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <Icon name="left" />
      </button>
      {nums.map((n, i) =>
        n === "…" ? (
          <span key={`e${i}`} className="pager-gap">…</span>
        ) : (
          <button key={n} className={`pager-num ${n === page ? "active" : ""}`} onClick={() => onPage(n)}>
            {n}
          </button>
        )
      )}
      <button className="pager-arrow" disabled={page === pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <Icon name="right" />
      </button>
    </div>
  );
}
