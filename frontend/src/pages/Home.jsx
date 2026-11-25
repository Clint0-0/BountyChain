// Overview dashboard: summary list, three distribution rings and an
// activity chart. Everything is read live from the contract and its events.
import { useMemo, useState } from "react";
import { ethers } from "ethers";
import { Link } from "react-router-dom";
import { useWeb3 } from "../context/Web3Context";
import { useAsync, loadSubmissions } from "../lib/hooks";
import { deployment, toProgram, programPhase, fmtEth, SEVERITY } from "../lib/contract";
import { Loading, ErrorBox } from "../components/ui";
import { Donut, AreaChart } from "../components/charts";

const RANGES = [
  ["1D", 86400],
  ["7D", 7 * 86400],
  ["1M", 30 * 86400],
  ["ALL", Infinity],
];

async function blockTimes(provider, logs) {
  const cache = new Map();
  for (const l of logs) if (!cache.has(l.blockNumber)) cache.set(l.blockNumber, (await provider.getBlock(l.blockNumber)).timestamp);
  return cache;
}

export default function Home() {
  const { readContract, readProvider, account, connect, hasMetaMask } = useWeb3();
  const [tab, setTab] = useState("rewards");
  const [range, setRange] = useState("ALL");

  const { data, loading, error } = useAsync(async () => {
    const c = readContract;
    const [stats, pCount] = await Promise.all([c.getStats(), c.programCount()]);
    const programs = await Promise.all(Array.from({ length: Number(pCount) }, (_, i) => c.getProgram(i + 1).then(toProgram)));
    const subs = await loadSubmissions(c, Array.from({ length: Number(stats.submissions) }, (_, i) => i + 1));
    const from = deployment.deployBlock || 0;
    const [claimed, submitted, funded, withdrawn] = await Promise.all([
      c.queryFilter(c.filters.RewardClaimed(), from),
      c.queryFilter(c.filters.ReportSubmitted(), from),
      c.queryFilter(c.filters.ProgramFunded(), from),
      c.queryFilter(c.filters.FundsWithdrawn(), from),
    ]);
    const times = await blockTimes(readProvider, [...claimed, ...submitted, ...funded, ...withdrawn]);
    const cumulative = (logs, val, note) => {
      let acc = 0;
      return logs
        .map((l) => ({ l, t: times.get(l.blockNumber) }))
        .sort((a, b) => a.t - b.t || a.l.index - b.l.index)
        .map(({ l, t }) => ({ t, v: (acc += val(l)), note: note(l) }));
    };
    const eth = (w) => Number(ethers.formatEther(w));
    const funding = [...funded.map((l) => ({ l, sign: 1 })), ...withdrawn.map((l) => ({ l, sign: -1 }))]
      .map(({ l, sign }) => ({ l, t: times.get(l.blockNumber), d: sign * eth(l.args.amount) }))
      .sort((a, b) => a.t - b.t);
    let acc = 0;
    const series = {
      rewards: cumulative(claimed, (l) => eth(l.args.amount), (l) => `Report #${l.args.submissionId} claimed ${ethers.formatEther(l.args.amount)} ETH`),
      reports: cumulative(submitted, () => 1, (l) => `Report #${l.args.submissionId} → program #${l.args.programId}`),
      funding: funding.map(({ l, t, d }) => ({ t, v: (acc += d), note: `${d > 0 ? "Funded" : "Withdrew"} ${Math.abs(d)} ETH · program #${l.args.programId}` })),
    };
    const last = Math.max(0, ...subs.map((s) => s.submittedAt), ...[...times.values()]);
    return { stats, programs, subs, series, last };
  }, [readContract, readProvider]);

  const view = useMemo(() => {
    if (!data) return null;
    const { stats, programs, subs } = data;
    const by = (st) => subs.filter((s) => s.status === st).length;
    const sum = (k) => programs.reduce((a, p) => a + p[k], 0n);
    const sev = [1, 2, 3, 4].map((i) => subs.filter((s) => s.severity === SEVERITY[i]).length);
    return {
      summary: [
        ["Bounty programs", programs.length],
        ["Open programs", programs.filter((p) => programPhase(p) === "Open").length],
        ["Organizations", Number(stats.orgs)],
        ["Reports submitted", subs.length],
        ["Pending review", by("Submitted"), "info"],
        ["Approved / claimed", by("Approved") + by("Claimed"), "pos"],
        ["Rejected", by("Rejected") + by("RejectionUpheld"), "neg"],
        ["Disputes raised", Number(stats.disputes)],
        ["Funds in pools", fmtEth(sum("availableBalance") + sum("reservedBalance"), 3), "warn"],
        ["Reserved for researchers", fmtEth(sum("reservedBalance"), 3)],
        ["Rewards paid", fmtEth(stats.distributed, 3), "pos"],
        ["Last activity", data.last ? ago(data.last) : "—"],
      ],
      status: [
        { label: "Pending review", value: by("Submitted"), color: "#1e9bff" },
        { label: "Approved", value: by("Approved"), color: "#3ccf6e" },
        { label: "Claimed", value: by("Claimed"), color: "#19c6ff" },
        { label: "Rejected", value: by("Rejected") + by("RejectionUpheld"), color: "#ff5c5c" },
        { label: "In dispute", value: by("Disputed"), color: "#f5b400" },
      ],
      severity: [
        { label: "Low", value: sev[0], color: "#1e9bff" },
        { label: "Medium", value: sev[1], color: "#f5b400" },
        { label: "High", value: sev[2], color: "#ff8a3d" },
        { label: "Critical", value: sev[3], color: "#ff5c5c" },
      ],
      pool: [
        { label: "Available", value: Number(ethers.formatEther(sum("availableBalance"))), color: "#3ccf6e" },
        { label: "Reserved", value: Number(ethers.formatEther(sum("reservedBalance"))), color: "#f5b400" },
        { label: "Paid out", value: Number(ethers.formatEther(sum("totalPaid"))), color: "#8b6cf6" },
      ],
    };
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error) return <ErrorBox error={`Cannot read the contract: ${error}. Check that the Hardhat node is running and the contract is deployed.`} />;

  const today = new Date().toLocaleDateString(undefined, { month: "long", day: "numeric", year: "numeric" });
  const cutoff = Date.now() / 1000 - RANGES.find((r) => r[0] === range)[1];
  const pts = data.series[tab].filter((p) => p.t >= cutoff);
  const fmt = tab === "reports" ? (v) => Math.round(v) : (v) => `${+v.toFixed(3)}`;

  return (
    <div className="dash">
      {!account && (
        <div className="notice">
          <span>Connect a wallet to submit reports, review findings or manage programs. Everything on this page is read directly from the chain.</span>
          {hasMetaMask && <button className="btn btn-primary btn-sm" onClick={connect}>Connect MetaMask</button>}
        </div>
      )}
      <div className="dash-grid">
        <section className="panel">
          <div className="panel-title">Summary</div>
          <dl className="kv">
            {view.summary.map(([k, v, tone]) => (
              <div key={k} className="kv-row">
                <dt>{k}</dt>
                <dd className={tone ? `t-${tone}` : ""}>{v}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section className="panel">
          <div className="panel-title">Report status</div>
          <div className="panel-sub">As of {today}</div>
          <Donut data={view.status} />
        </section>
        <section className="panel">
          <div className="panel-title">Approved severity</div>
          <div className="panel-sub">As of {today}</div>
          <Donut data={view.severity} />
        </section>
        <section className="panel">
          <div className="panel-title">Reward pool allocation</div>
          <div className="panel-sub">As of {today} · ETH</div>
          <Donut data={view.pool} format={(v) => `${+v.toFixed(3)}`} />
        </section>
      </div>

      <section className="panel">
        <div className="chart-bar">
          <div className="tabs">
            {[
              ["rewards", "Rewards paid"],
              ["reports", "Reports submitted"],
              ["funding", "Pool funding"],
            ].map(([k, l]) => (
              <button key={k} className={tab === k ? "active" : ""} onClick={() => setTab(k)}>
                {l}
              </button>
            ))}
          </div>
          <div className="ranges">
            {RANGES.map(([r]) => (
              <button key={r} className={range === r ? "active" : ""} onClick={() => setRange(r)}>
                {r}
              </button>
            ))}
          </div>
        </div>
        <AreaChart
          points={pts}
          color={tab === "rewards" ? "#3ccf6e" : tab === "reports" ? "#1e9bff" : "#f5b400"}
          format={fmt}
          emptyText={data.series[tab].length ? "No activity in this range" : "No on-chain activity yet"}
        />
        <div className="chart-foot muted small">
          Cumulative values built from <code>{tab === "rewards" ? "RewardClaimed" : tab === "reports" ? "ReportSubmitted" : "ProgramFunded / FundsWithdrawn"}</code> events.
          {" "}<Link to="/programs">Browse programs →</Link>
        </div>
      </section>
    </div>
  );
}

function ago(ts) {
  const s = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min ago`;
  return `${Math.floor(s / 86400)} days ago`;
}
