// One submission: on-chain record, event timeline, confidential report (backend,
// authorised) and the actions the connected wallet is allowed to take.
import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useWeb3 } from "../context/Web3Context";
import { useTx } from "../context/TxContext";
import { useAsync, loadProgram, loadDispute, loadSubmissionTimeline } from "../lib/hooks";
import { toSubmission, fmtEth, fmtDate, SEVERITY, ZERO_ADDR } from "../lib/contract";
import { StatusBadge, SeverityBadge, Addr, Badge, Loading, ErrorBox, Section, CopyText, Gate } from "../components/ui";
import EventList from "../components/EventList";

export default function SubmissionDetail() {
  return (
    <Gate>
      <SubmissionDetailInner />
    </Gate>
  );
}

function SubmissionDetailInner() {
  const { id } = useParams();
  const { readContract, account } = useWeb3();
  const { data, loading, error } = useAsync(async () => {
    const s = toSubmission(await readContract.getSubmission(Number(id)));
    const [program, dispute, timeline, isVerifier, resolver, deadline] = await Promise.all([
      loadProgram(readContract, s.programId),
      loadDispute(readContract, s.id),
      loadSubmissionTimeline(readContract, s.id),
      readContract.isVerifier(s.programId, account),
      readContract.disputeResolver(),
      readContract.disputeDeadline(Number(id)),
    ]);
    return { s, program, dispute, timeline, isVerifier, resolver, disputeDeadline: Number(deadline) };
  }, [readContract, id, account]);

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const { s, program, dispute, timeline, isVerifier, resolver, disputeDeadline } = data;
  const me = account.toLowerCase();
  const isResearcher = s.researcher.toLowerCase() === me;
  const isOwner = program.owner.toLowerCase() === me;
  const isResolver = resolver.toLowerCase() === me;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">
            <Link to={`/programs/${program.id}`}>{program.title}</Link> · Submission #{s.id}
          </div>
          <h1 className="row gap">
            Report #{s.id} <StatusBadge status={s.status} />
          </h1>
          <div className="row gap small">
            {isResearcher && <Badge tone="accent">You are the researcher</Badge>}
            {isOwner && <Badge tone="accent">You own this program</Badge>}
            {isVerifier && <Badge tone="accent">You are a verifier</Badge>}
            {isResolver && dispute.status !== "None" && <Badge tone="accent">You are the dispute resolver</Badge>}
          </div>
        </div>
      </div>

      <div className="two-col">
        <div className="col-main">
          <Actions data={data} roles={{ isResearcher, isVerifier, isResolver }} disputeDeadline={disputeDeadline} />
          <ReportPanel submissionId={s.id} canTry={isResearcher || isOwner || isVerifier || (isResolver && dispute.status !== "None")} />
          <Section title="On-chain history">
            <EventList events={timeline} />
          </Section>
        </div>
        <div className="col-side">
          <Section title="On-chain record">
            <dl className="details compact">
              <dt>Program</dt><dd>#{s.programId}</dd>
              <dt>Researcher</dt><dd><Addr address={s.researcher} /></dd>
              <dt>Report hash</dt><dd><CopyText text={s.reportHash} /></dd>
              <dt>Submitted</dt><dd>{fmtDate(s.submittedAt)}</dd>
              <dt>Status</dt><dd><StatusBadge status={s.status} /></dd>
              <dt>Severity</dt><dd><SeverityBadge severity={s.severity} /></dd>
              <dt>Reward</dt><dd>{s.reward > 0n ? fmtEth(s.reward) : "—"}</dd>
              <dt>Reviewer</dt><dd>{s.reviewer !== ZERO_ADDR ? <Addr address={s.reviewer} /> : "—"}</dd>
              <dt>Reviewed</dt><dd>{fmtDate(s.reviewedAt)}</dd>
              {s.reviewedAt > 0 && <><dt>Review note hash</dt><dd><CopyText text={s.reviewNoteHash} /></dd></>}
            </dl>
          </Section>
          {dispute.status !== "None" && (
            <Section title="Dispute">
              <dl className="details compact">
                <dt>Status</dt><dd><Badge tone={dispute.status === "Open" ? "warn" : dispute.status === "Overturned" ? "success" : "danger"}>{dispute.status}</Badge></dd>
                <dt>Raised</dt><dd>{fmtDate(dispute.raisedAt)}</dd>
                <dt>Evidence hash</dt><dd><CopyText text={dispute.evidenceHash} /></dd>
                <dt>Resolver</dt><dd>{dispute.resolver !== ZERO_ADDR ? <Addr address={dispute.resolver} /> : "—"}</dd>
                <dt>Resolved</dt><dd>{fmtDate(dispute.resolvedAt)}</dd>
              </dl>
            </Section>
          )}
          <Section title="Reward tiers">
            <div className="tiers tiers-v">
              {program.rewards.map((r, i) => (
                <div key={i} className={`tier tier-${i + 1}`}><span>{SEVERITY[i + 1]}</span><b>{fmtEth(r)}</b></div>
              ))}
            </div>
            <p className="muted small">Pool available: {fmtEth(program.availableBalance)}</p>
          </Section>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ report
const DOC_LABEL = { review_note: "Verifier review note", dispute_evidence: "Dispute reason & evidence", resolution_note: "Dispute resolution note" };

function ReportPanel({ submissionId, canTry }) {
  const { authedApi } = useWeb3();
  const [state, setState] = useState({ data: null, error: null, loading: false });
  async function load() {
    setState({ data: null, error: null, loading: true });
    try {
      setState({ data: await authedApi(`/api/submissions/${submissionId}/report`), error: null, loading: false });
    } catch (e) {
      setState({ data: null, error: e.message, loading: false });
    }
  }
  const r = state.data?.report;
  return (
    <Section
      title="Confidential report"
      actions={<button className="btn btn-outline btn-sm" onClick={load} disabled={state.loading}>{state.data ? "Reload" : "🔓 Decrypt & view"}</button>}
    >
      {!state.data && !state.error && (
        <p className="muted">
          {canTry
            ? "Contents are stored encrypted off-chain. Sign a message (no gas) to prove your wallet; the server checks your on-chain role before decrypting."
            : "Your wallet holds no role for this submission. The server will refuse access (you can try — it will be logged)."}
        </p>
      )}
      {state.loading && <Loading text="Authenticating and decrypting…" />}
      <ErrorBox error={state.error} />
      {r && (
        <div className="report">
          <div className="row gap">
            {state.data.integrity.verified ? (
              <Badge tone="success" title={`computed ${state.data.integrity.computedHash}`}>✔ Integrity verified against on-chain hash</Badge>
            ) : (
              <Badge tone="danger">✖ Integrity check FAILED</Badge>
            )}
            <span className="muted small">Access as: {state.data.roles.join(", ")}</span>
          </div>
          <h3>{r.title}</h3>
          <dl className="details">
            <dt>Suggested severity</dt><dd><SeverityBadge severity={r.suggestedSeverity} /></dd>
            <dt>Affected component</dt><dd className="pre">{r.affectedComponent}</dd>
            <dt>Description</dt><dd className="pre">{r.description}</dd>
            <dt>Steps to reproduce</dt><dd className="pre">{r.stepsToReproduce}</dd>
            <dt>Proof of concept</dt><dd><pre className="code">{r.proofOfConcept}</pre></dd>
            <dt>Impact</dt><dd className="pre">{r.impact}</dd>
            {r.additionalNotes && <><dt>Additional notes</dt><dd className="pre">{r.additionalNotes}</dd></>}
            <dt>Created</dt><dd>{new Date(r.createdAt).toLocaleString()}</dd>
          </dl>
          {state.data.documents.length > 0 && (
            <>
              <h4>Review &amp; dispute documents</h4>
              {state.data.documents.map((d) => (
                <div key={d.hash} className="doc">
                  <div className="row gap small">
                    <b>{DOC_LABEL[d.kind]}</b>
                    <Addr address={d.author} />
                    <span className="muted">{new Date(d.createdAt).toLocaleString()}</span>
                    {d.anchoredOnChain ? <Badge tone="success">⛓ anchored on-chain</Badge> : <Badge>draft (not on-chain)</Badge>}
                  </div>
                  <p className="pre">{d.content}</p>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </Section>
  );
}

// ------------------------------------------------------------------ actions
function Actions({ data, roles, disputeDeadline }) {
  const { s, dispute, program } = data;
  const now = Date.now() / 1000;
  const blocks = [];
  if (roles.isVerifier && !roles.isResearcher && s.status === "Submitted") blocks.push(<ReviewForm key="r" s={s} program={program} />);
  if (roles.isResearcher && s.status === "Approved") blocks.push(<ClaimBox key="c" s={s} />);
  if (roles.isResearcher && s.status === "Rejected" && dispute.status === "None") {
    blocks.push(now <= disputeDeadline ? <DisputeForm key="d" s={s} deadline={disputeDeadline} /> : <div key="d" className="alert alert-info">The dispute window closed on {fmtDate(disputeDeadline)}.</div>);
  }
  if (roles.isResolver && !roles.isResearcher && s.status === "Disputed") blocks.push(<ResolveForm key="x" s={s} program={program} />);
  if (s.status === "Submitted" && roles.isResearcher) blocks.push(<div key="w" className="alert alert-info">Awaiting review by an assigned verifier.</div>);
  if (s.status === "Disputed" && roles.isResearcher) blocks.push(<div key="w2" className="alert alert-warn">Your dispute is waiting for the dispute resolver.</div>);
  if (!blocks.length) return null;
  return <Section title="Actions">{blocks}</Section>;
}

/** Store an encrypted note via backend, then return its hash for the contract call. */
function useDocument(submissionId) {
  const { authedApi } = useWeb3();
  return (kind, content) => authedApi(`/api/submissions/${submissionId}/documents`, { method: "POST", body: { kind, content } }).then((r) => r.docHash);
}

function ReviewForm({ s, program }) {
  const { writeContract } = useWeb3();
  const { runTx } = useTx();
  const saveDoc = useDocument(s.id);
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  async function decide(approve) {
    setErr(null);
    if (note.trim().length < 5) return setErr("Write a review note (at least 5 characters). It is stored encrypted; its hash goes on-chain.");
    if (approve && program.availableBalance < program.rewards[severity - 1]) return setErr("Pool has insufficient available funds for this tier. Ask the organization to top up.");
    setBusy(true);
    try {
      const noteHash = await saveDoc("review_note", note.trim());
      await runTx(
        approve ? `Approve report #${s.id} as ${SEVERITY[severity]}` : `Reject report #${s.id}`,
        () => (approve ? writeContract.approveReport(s.id, severity, noteHash) : writeContract.rejectReport(s.id, noteHash))
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form">
      <h3>Review this report</h3>
      <label className="field">
        <span>Review decision note (confidential)</span>
        <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reproduction result, reasoning, severity justification…" />
      </label>
      <label className="field">
        <span>Severity if approved</span>
        <select className="input" value={severity} onChange={(e) => setSeverity(Number(e.target.value))}>
          {[1, 2, 3, 4].map((i) => (
            <option key={i} value={i}>{SEVERITY[i]} — {fmtEth(program.rewards[i - 1])}</option>
          ))}
        </select>
      </label>
      <ErrorBox error={err} />
      <div className="row gap">
        <button className="btn btn-success" disabled={busy} onClick={() => decide(true)}>Approve &amp; reserve reward</button>
        <button className="btn btn-danger" disabled={busy} onClick={() => decide(false)}>Reject</button>
      </div>
    </div>
  );
}

function ClaimBox({ s }) {
  const { writeContract } = useWeb3();
  const { runTx } = useTx();
  const [busy, setBusy] = useState(false);
  return (
    <div className="claim">
      <div>
        <div className="muted small">Reserved for you in the contract</div>
        <div className="big">{fmtEth(s.reward)}</div>
      </div>
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await runTx(`Claim ${fmtEth(s.reward)} for report #${s.id}`, () => writeContract.claimReward(s.id));
          setBusy(false);
        }}
      >
        Claim reward
      </button>
    </div>
  );
}

function DisputeForm({ s, deadline }) {
  const { writeContract } = useWeb3();
  const { runTx } = useTx();
  const saveDoc = useDocument(s.id);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function raise() {
    setErr(null);
    if (text.trim().length < 20) return setErr("Explain the reason and evidence (at least 20 characters).");
    setBusy(true);
    try {
      const evidenceHash = await saveDoc("dispute_evidence", text.trim());
      await runTx(`Raise dispute on report #${s.id}`, () => writeContract.raiseDispute(s.id, evidenceHash));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form">
      <h3>Dispute this rejection</h3>
      <p className="muted small">Window closes {fmtDate(deadline)}. One dispute per report; the resolver's decision is final.</p>
      <label className="field">
        <span>Reason &amp; supporting evidence (confidential)</span>
        <textarea className="input" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="Why the rejection is wrong, extra PoC, links…" />
      </label>
      <ErrorBox error={err} />
      <button className="btn btn-warn" disabled={busy} onClick={raise}>Raise dispute on-chain</button>
    </div>
  );
}

function ResolveForm({ s, program }) {
  const { writeContract } = useWeb3();
  const { runTx } = useTx();
  const saveDoc = useDocument(s.id);
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState(2);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  async function resolve(overturn) {
    setErr(null);
    if (note.trim().length < 5) return setErr("Write a resolution note.");
    setBusy(true);
    try {
      const noteHash = await saveDoc("resolution_note", note.trim());
      await runTx(
        overturn ? `Overturn rejection of #${s.id} → ${SEVERITY[severity]}` : `Uphold rejection of #${s.id}`,
        () => writeContract.resolveDispute(s.id, overturn, overturn ? severity : 0, noteHash)
      );
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="form">
      <h3>Resolve dispute</h3>
      <p className="muted small">Decrypt the report below to read the original verifier note and the researcher's evidence.</p>
      <label className="field">
        <span>Resolution note (confidential)</span>
        <textarea className="input" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
      </label>
      <label className="field">
        <span>Severity if overturned</span>
        <select className="input" value={severity} onChange={(e) => setSeverity(Number(e.target.value))}>
          {[1, 2, 3, 4].map((i) => (
            <option key={i} value={i}>{SEVERITY[i]} — {fmtEth(program.rewards[i - 1])}</option>
          ))}
        </select>
      </label>
      <ErrorBox error={err} />
      <div className="row gap">
        <button className="btn btn-success" disabled={busy} onClick={() => resolve(true)}>Overturn &amp; approve</button>
        <button className="btn btn-danger" disabled={busy} onClick={() => resolve(false)}>Uphold rejection</button>
      </div>
    </div>
  );
}
