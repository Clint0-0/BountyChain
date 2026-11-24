import { useState } from "react";
import { Link } from "react-router-dom";
import { ethers } from "ethers";
import { useWeb3 } from "../context/Web3Context";
import { useTx } from "../context/TxContext";
import { useAsync, loadProgram, loadSubmissions } from "../lib/hooks";
import { useTitles } from "../lib/useTitles";
import { fmtEth, fmtDate, programPhase, SEVERITY } from "../lib/contract";
import { Gate, Section, Stat, Loading, ErrorBox, Empty, PhaseBadge, Addr } from "../components/ui";
import SubmissionTable from "../components/SubmissionTable";

export default function OrgDashboard() {
  return (
    <Gate need={(r) => r.isOrg} roleName="Organization">
      <Inner />
    </Gate>
  );
}

function Inner() {
  const { readContract, account } = useWeb3();
  const [showCreate, setShowCreate] = useState(false);
  const { data, loading, error } = useAsync(async () => {
    const org = await readContract.getOrganization(account);
    const ids = (await readContract.getOrganizationPrograms(account)).map(Number);
    const programs = (await Promise.all(ids.map((id) => loadProgram(readContract, id)))).sort((a, b) => b.id - a.id);
    return { orgName: org.name, programs };
  }, [readContract, account]);

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const { programs, orgName } = data;
  const sum = (k) => programs.reduce((a, p) => a + p[k], 0n);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Organization</div>
          <h1>{orgName}</h1>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(!showCreate)}>{showCreate ? "Close form" : "+ Create bounty program"}</button>
      </div>
      <div className="stats">
        <Stat label="Programs" value={programs.length} />
        <Stat label="Active" value={programs.filter((p) => programPhase(p) === "Open").length} />
        <Stat label="Reports received" value={programs.reduce((a, p) => a + p.submissionCount, 0)} />
        <Stat label="Available pool" value={fmtEth(sum("availableBalance"))} />
        <Stat label="Reserved" value={fmtEth(sum("reservedBalance"))} />
        <Stat label="Paid out" value={fmtEth(sum("totalPaid"))} />
      </div>
      {showCreate && <CreateProgram orgName={orgName} onDone={() => setShowCreate(false)} />}
      {programs.length ? (
        programs.map((p) => <ManageProgram key={p.id} p={p} />)
      ) : (
        <Empty title="No programs yet" icon="🛡">Create your first bounty program and fund its reward pool.</Empty>
      )}
    </div>
  );
}

// ------------------------------------------------------------------ create
function toLocalInput(d) {
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 16);
}

function CreateProgram({ orgName, onDone }) {
  const { authedApi, writeContract } = useWeb3();
  const { runTx } = useTx();
  const now = new Date();
  const [f, setF] = useState({
    title: "",
    organizationName: orgName,
    description: "",
    targetSystem: "",
    inScope: "",
    outOfScope: "",
    rules: "",
    start: toLocalInput(now),
    end: toLocalInput(new Date(now.getTime() + 30 * 86400000)),
    r1: "0.1",
    r2: "0.5",
    r3: "1",
    r4: "2",
    funding: "5",
  });
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  function validate() {
    if (f.title.trim().length < 3) return "Title must be at least 3 characters.";
    if (f.description.trim().length < 10) return "Description must be at least 10 characters.";
    for (const k of ["targetSystem", "inScope", "outOfScope", "rules"]) if (!f[k].trim()) return `${k} is required.`;
    const s = new Date(f.start).getTime(), e = new Date(f.end).getTime();
    if (!(e > s) || e <= Date.now()) return "End date must be after start and in the future.";
    let prev = 0;
    for (const k of ["r1", "r2", "r3", "r4"]) {
      const v = Number(f[k]);
      if (!(v > 0)) return "All reward tiers must be greater than 0.";
      if (v < prev) return "Reward tiers must not decrease (Low ≤ Medium ≤ High ≤ Critical).";
      prev = v;
    }
    if (!(Number(f.funding) > 0)) return "Initial funding must be greater than 0.";
    return null;
  }

  async function submit(e) {
    e.preventDefault();
    const v = validate();
    if (v) return setErr(v);
    setErr(null);
    setBusy(true);
    try {
      // 1) store full details off-chain, get hash
      const { metadataHash } = await authedApi("/api/programs/metadata", {
        method: "POST",
        body: { title: f.title, organizationName: f.organizationName, description: f.description, targetSystem: f.targetSystem, inScope: f.inScope, outOfScope: f.outOfScope, rules: f.rules },
      });
      // 2) create + fund on-chain
      const rewards = ["r1", "r2", "r3", "r4"].map((k) => ethers.parseEther(f[k]));
      const start = Math.floor(new Date(f.start).getTime() / 1000);
      const end = Math.floor(new Date(f.end).getTime() / 1000);
      const receipt = await runTx(`Create program "${f.title}" funded with ${f.funding} ETH`, () =>
        writeContract.createProgram(f.title.trim(), metadataHash, start, end, rewards, { value: ethers.parseEther(f.funding) })
      );
      if (receipt) onDone();
    } catch (e2) {
      setErr(e2.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section title="Create bounty program">
      <form className="form grid-form" onSubmit={submit} noValidate>
        <label className="field"><span>Program title</span><input className="input" value={f.title} onChange={set("title")} maxLength={120} /></label>
        <label className="field"><span>Organization name</span><input className="input" value={f.organizationName} onChange={set("organizationName")} maxLength={120} /></label>
        <label className="field span2"><span>Description</span><textarea className="input" rows={3} value={f.description} onChange={set("description")} /></label>
        <label className="field span2"><span>Target application / system</span><input className="input" value={f.targetSystem} onChange={set("targetSystem")} placeholder="https://app.example.com, Android app v3" /></label>
        <label className="field"><span>In-scope vulnerabilities / assets</span><textarea className="input" rows={3} value={f.inScope} onChange={set("inScope")} /></label>
        <label className="field"><span>Out-of-scope</span><textarea className="input" rows={3} value={f.outOfScope} onChange={set("outOfScope")} /></label>
        <label className="field span2"><span>Rules &amp; submission guidelines</span><textarea className="input" rows={3} value={f.rules} onChange={set("rules")} /></label>
        <label className="field"><span>Start</span><input type="datetime-local" className="input" value={f.start} onChange={set("start")} /></label>
        <label className="field"><span>End</span><input type="datetime-local" className="input" value={f.end} onChange={set("end")} /></label>
        <div className="field span2">
          <span>Reward tiers (ETH)</span>
          <div className="tier-inputs">
            {["r1", "r2", "r3", "r4"].map((k, i) => (
              <label key={k} className={`tier tier-${i + 1}`}><span>{SEVERITY[i + 1]}</span><input className="input" type="number" min="0" step="0.01" value={f[k]} onChange={set(k)} /></label>
            ))}
          </div>
        </div>
        <label className="field"><span>Initial reward pool funding (ETH)</span><input className="input" type="number" min="0" step="0.01" value={f.funding} onChange={set("funding")} /></label>
        <div className="field span2"><ErrorBox error={err} /></div>
        <div className="span2"><button className="btn btn-primary" disabled={busy}>{busy ? "Working…" : "Publish & fund program"}</button></div>
      </form>
    </Section>
  );
}

// ------------------------------------------------------------------ manage
function ManageProgram({ p }) {
  const { readContract, writeContract } = useWeb3();
  const { runTx } = useTx();
  const [open, setOpen] = useState(false);
  const [fund, setFund] = useState("1");
  const [withdraw, setWithdraw] = useState("");
  const [verifier, setVerifier] = useState("");
  const [err, setErr] = useState(null);
  const details = useAsync(async () => {
    if (!open) return null;
    const verifiers = await readContract.getProgramVerifiers(p.id);
    const ids = (await readContract.getProgramSubmissions(p.id)).map(Number);
    const subs = (await loadSubmissions(readContract, ids)).sort((a, b) => b.id - a.id);
    return { verifiers, subs };
  }, [readContract, p.id, open]);
  const { titles, unlock, unlocked } = useTitles(details.data?.subs.map((s) => s.id));
  const phase = programPhase(p);

  const tx = (label, fn) => {
    setErr(null);
    return runTx(label, fn);
  };

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2 className="row gap">
            <Link to={`/programs/${p.id}`}>#{p.id} {p.title}</Link> <PhaseBadge phase={phase} />
          </h2>
          <div className="muted small">
            {fmtDate(p.startTime)} → {fmtDate(p.endTime)} · {p.submissionCount} reports · {p.openItems} awaiting action
          </div>
        </div>
        <button className="btn btn-ghost" onClick={() => setOpen(!open)}>{open ? "Hide ▲" : "Manage ▼"}</button>
      </div>
      <div className="pool">
        <div><span className="muted">Available</span><b>{fmtEth(p.availableBalance)}</b></div>
        <div><span className="muted">Reserved</span><b>{fmtEth(p.reservedBalance)}</b></div>
        <div><span className="muted">Paid</span><b>{fmtEth(p.totalPaid)}</b></div>
        <div className="pool-tiers">{p.rewards.map((r, i) => <span key={i} className={`tier-chip tier-${i + 1}`}>{SEVERITY[i + 1][0]} {fmtEth(r, 3)}</span>)}</div>
      </div>
      {open && (
        <div className="manage">
          <div className="manage-grid">
            <div className="mini">
              <h4>Fund pool</h4>
              <div className="row gap">
                <input className="input" type="number" min="0" step="0.01" value={fund} onChange={(e) => setFund(e.target.value)} />
                <button className="btn btn-primary btn-sm" onClick={() => (Number(fund) > 0 ? tx(`Fund program #${p.id} with ${fund} ETH`, () => writeContract.fundProgram(p.id, { value: ethers.parseEther(fund) })) : setErr("Enter an amount > 0"))}>Deposit</button>
              </div>
            </div>
            <div className="mini">
              <h4>Status</h4>
              <button className={`btn btn-sm ${p.active ? "btn-danger" : "btn-success"}`} onClick={() => tx(`${p.active ? "Deactivate" : "Activate"} program #${p.id}`, () => writeContract.setProgramActive(p.id, !p.active))}>
                {p.active ? "Deactivate program" : "Re-activate program"}
              </button>
            </div>
            <div className="mini">
              <h4>Withdraw unreserved</h4>
              <div className="row gap">
                <input className="input" type="number" min="0" step="0.01" placeholder="ETH" value={withdraw} onChange={(e) => setWithdraw(e.target.value)} />
                <button className="btn btn-outline btn-sm" onClick={() => (Number(withdraw) > 0 ? tx(`Withdraw ${withdraw} ETH from #${p.id}`, () => writeContract.withdrawUnreserved(p.id, ethers.parseEther(withdraw))) : setErr("Enter an amount > 0"))}>Withdraw</button>
              </div>
              <small className="muted">Only after the program is closed, nothing pending and the dispute window passed.</small>
            </div>
          </div>
          <ErrorBox error={err} />
          {details.loading && !details.data ? (
            <Loading />
          ) : details.data ? (
            <>
              <h4>Verifiers</h4>
              <div className="verifiers">
                {details.data.verifiers.length === 0 && <span className="muted">No verifiers yet — reports cannot be reviewed until you assign one.</span>}
                {details.data.verifiers.map((v) => (
                  <div key={v} className="verifier-row">
                    <Addr address={v} />
                    <button className="btn btn-ghost btn-sm" onClick={() => tx(`Remove verifier from #${p.id}`, () => writeContract.removeVerifier(p.id, v))}>Remove</button>
                  </div>
                ))}
              </div>
              <div className="row gap">
                <input className="input mono" placeholder="0x… verifier wallet address" value={verifier} onChange={(e) => setVerifier(e.target.value)} />
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => {
                    if (!ethers.isAddress(verifier)) return setErr("Enter a valid address.");
                    tx(`Assign verifier to #${p.id}`, () => writeContract.assignVerifier(p.id, ethers.getAddress(verifier))).then((r) => r && setVerifier(""));
                  }}
                >
                  Assign verifier
                </button>
              </div>
              <div className="row between">
                <h4>Submitted reports</h4>
                {!unlocked && details.data.subs.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => unlock().catch(() => {})}>🔓 Unlock titles</button>}
              </div>
              <SubmissionTable subs={details.data.subs} titles={titles} programs={{ [p.id]: p }} />
            </>
          ) : null}
        </div>
      )}
    </section>
  );
}
