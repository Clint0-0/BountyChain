import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useWeb3 } from "../context/Web3Context";
import { useTx } from "../context/TxContext";
import { useAsync, loadProgram, loadProgramFunding } from "../lib/hooks";
import { fmtEth, fmtDate, programPhase, SEVERITY, iface } from "../lib/contract";
import { PhaseBadge, Badge, Addr, Loading, ErrorBox, Empty, Section, CopyText } from "../components/ui";
import EventList from "../components/EventList";

export default function ProgramDetail() {
  const { id } = useParams();
  const { readContract, account, roles, correctNetwork, switchNetwork } = useWeb3();
  const { data, loading, error } = useAsync(async () => {
    const p = await loadProgram(readContract, Number(id));
    const [verifiers, funding] = await Promise.all([readContract.getProgramVerifiers(p.id), loadProgramFunding(readContract, p.id)]);
    return { p, verifiers, funding };
  }, [readContract, id]);

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const { p, verifiers, funding } = data;
  const phase = programPhase(p);
  const me = account?.toLowerCase();
  const isOwner = me === p.owner.toLowerCase();
  const isProgVerifier = verifiers.some((v) => v.toLowerCase() === me);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">{p.meta?.organizationName || "Organization"} · Program #{p.id}</div>
          <h1>{p.title}</h1>
          <div className="row gap">
            <PhaseBadge phase={phase} />
            {p.meta ? (
              p.meta._verified ? <Badge tone="success" title="keccak256(metadata) matches on-chain metadataHash">✔ Metadata integrity verified</Badge> : <Badge tone="danger">✖ Metadata hash mismatch</Badge>
            ) : (
              <Badge tone="warn" title={p.metaWarning}>{p.metaWarning ? "⚠ Metadata owner mismatch" : "Off-chain metadata unavailable"}</Badge>
            )}
            <span className="muted">Owner</span> <Addr address={p.owner} />
          </div>
        </div>
        {isOwner && <Link className="btn btn-outline" to="/organization">Manage program</Link>}
      </div>

      <div className="stats">
        <div className="stat"><div className="stat-label">Available pool</div><div className="stat-value">{fmtEth(p.availableBalance)}</div></div>
        <div className="stat"><div className="stat-label">Reserved for approved</div><div className="stat-value">{fmtEth(p.reservedBalance)}</div></div>
        <div className="stat"><div className="stat-label">Paid out</div><div className="stat-value">{fmtEth(p.totalPaid)}</div></div>
        <div className="stat"><div className="stat-label">Reports</div><div className="stat-value">{p.submissionCount}</div></div>
      </div>

      <div className="two-col">
        <div className="col-main">
          <Section title="Program details">
            {p.meta ? (
              <dl className="details">
                <dt>Description</dt><dd className="pre">{p.meta.description}</dd>
                <dt>Target system</dt><dd className="pre">{p.meta.targetSystem}</dd>
                <dt>In scope</dt><dd className="pre">{p.meta.inScope}</dd>
                <dt>Out of scope</dt><dd className="pre">{p.meta.outOfScope}</dd>
                <dt>Rules &amp; guidelines</dt><dd className="pre">{p.meta.rules}</dd>
              </dl>
            ) : (
              <Empty title="Details unavailable" icon="⚠">{p.metaWarning || `The backend did not return metadata for hash ${p.metadataHash}.`}</Empty>
            )}
          </Section>
          <Section title="Submit a vulnerability report">
            {!account ? (
              <Empty title="Connect your wallet to submit" icon="🔌" />
            ) : !correctNetwork ? (
              <Empty title="Wrong network" icon="⛓"><button className="btn btn-primary" onClick={switchNetwork}>Switch network</button></Empty>
            ) : phase !== "Open" ? (
              <Empty title={`Program is ${phase.toLowerCase()}`} icon="⏸">Submissions are only accepted while the program is active and within its dates.</Empty>
            ) : isOwner || isProgVerifier ? (
              <Empty title="Conflict of interest" icon="⛔">Program owners and their verifiers cannot submit reports to this program.</Empty>
            ) : roles.isAdmin ? (
              <Empty title="Admin wallet" icon="⛔">Use a researcher wallet to submit reports.</Empty>
            ) : (
              <SubmitReportForm programId={p.id} />
            )}
          </Section>
        </div>
        <div className="col-side">
          <Section title="Reward tiers">
            <div className="tiers tiers-v">
              {p.rewards.map((r, i) => (
                <div key={i} className={`tier tier-${i + 1}`}><span>{SEVERITY[i + 1]}</span><b>{fmtEth(r)}</b></div>
              ))}
            </div>
            <p className="muted small">Rewards are fixed by the contract. Verifiers only choose a severity, never an amount.</p>
          </Section>
          <Section title="Timeline">
            <dl className="details compact">
              <dt>Starts</dt><dd>{fmtDate(p.startTime)}</dd>
              <dt>Ends</dt><dd>{fmtDate(p.endTime)}</dd>
              <dt>Verifiers</dt><dd>{verifiers.length}</dd>
              <dt>Metadata hash</dt><dd><CopyText text={p.metadataHash} /></dd>
            </dl>
          </Section>
          <Section title="Funding history">
            <EventList events={funding} empty="No funding events" />
          </Section>
        </div>
      </div>
    </div>
  );
}

const FIELDS = [
  { k: "title", label: "Report title", min: 5, max: 200, type: "input", ph: "e.g. Stored XSS in profile bio" },
  { k: "description", label: "Vulnerability description", min: 20, max: 20000, ph: "What is the vulnerability and where does it occur?" },
  { k: "affectedComponent", label: "Affected component", min: 1, max: 500, type: "input", ph: "e.g. /api/v1/profile, mobile app login" },
  { k: "stepsToReproduce", label: "Steps to reproduce", min: 10, max: 20000, ph: "1. …\n2. …\n3. …" },
  { k: "proofOfConcept", label: "Proof-of-concept evidence", min: 5, max: 50000, ph: "Payloads, requests, screenshots links, script…", mono: true },
  { k: "impact", label: "Potential impact", min: 5, max: 10000, ph: "What can an attacker achieve?" },
  { k: "additionalNotes", label: "Additional notes (optional)", min: 0, max: 10000, optional: true },
];

function SubmitReportForm({ programId }) {
  const { authedApi, writeContract } = useWeb3();
  const { runTx } = useTx();
  const nav = useNavigate();
  const [form, setForm] = useState({ suggestedSeverity: "Medium" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  function validate() {
    const e = {};
    for (const f of FIELDS) {
      const v = (form[f.k] || "").trim();
      if (!f.optional && v.length < f.min) e[f.k] = `At least ${f.min} characters`;
      if (v.length > f.max) e[f.k] = `At most ${f.max} characters`;
    }
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  async function submit(ev) {
    ev.preventDefault();
    setMsg(null);
    if (!validate()) return;
    setBusy(true);
    try {
      // 1) Encrypt + store off-chain, get the hash (wallet signature login if needed)
      setMsg({ tone: "info", text: "Storing encrypted report on the server…" });
      const { reportHash } = await authedApi("/api/reports", { method: "POST", body: { ...form, programId } });
      // 2) Anchor the hash on-chain
      setMsg({ tone: "info", text: `Report hash ${reportHash.slice(0, 18)}… — confirm the transaction in MetaMask.` });
      const receipt = await runTx(`Submit report to program #${programId}`, () => writeContract.submitReport(programId, reportHash));
      if (!receipt) {
        setMsg({ tone: "danger", text: "On-chain submission failed. The encrypted draft is not linked to any submission and will not be shown to anyone." });
        return;
      }
      const ev2 = receipt.logs.map((l) => { try { return iface.parseLog(l); } catch { return null; } }).find((x) => x?.name === "ReportSubmitted");
      nav(`/submissions/${ev2.args.submissionId}`);
    } catch (e) {
      setMsg({ tone: "danger", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  return (
    <form className="form" onSubmit={submit} noValidate>
      <div className="alert alert-info small">
        🔒 Full report content is encrypted (AES-256-GCM) and stored off-chain. Only its keccak256 hash, your address and timestamps go on the blockchain.
      </div>
      {FIELDS.map((f) => (
        <label key={f.k} className="field">
          <span>{f.label}</span>
          {f.type === "input" ? (
            <input className={`input ${errors[f.k] ? "invalid" : ""}`} value={form[f.k] || ""} onChange={set(f.k)} placeholder={f.ph} maxLength={f.max} />
          ) : (
            <textarea className={`input ${f.mono ? "mono" : ""} ${errors[f.k] ? "invalid" : ""}`} rows={f.k === "description" || f.k === "stepsToReproduce" ? 5 : 3} value={form[f.k] || ""} onChange={set(f.k)} placeholder={f.ph} maxLength={f.max} />
          )}
          {errors[f.k] && <small className="err">{errors[f.k]}</small>}
        </label>
      ))}
      <label className="field">
        <span>Suggested severity</span>
        <select className="input" value={form.suggestedSeverity} onChange={set("suggestedSeverity")}>
          {SEVERITY.slice(1).map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      {msg && <div className={`alert alert-${msg.tone}`}>{msg.text}</div>}
      <button className="btn btn-primary" disabled={busy}>{busy ? "Submitting…" : "Encrypt & submit report"}</button>
    </form>
  );
}
