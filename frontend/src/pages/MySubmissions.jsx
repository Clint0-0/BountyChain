import { Link } from "react-router-dom";
import { useWeb3 } from "../context/Web3Context";
import { useTx } from "../context/TxContext";
import { useAsync, loadSubmissions, loadClaims } from "../lib/hooks";
import { useTitles } from "../lib/useTitles";
import { fmtEth } from "../lib/contract";
import { Gate, Section, Stat, Loading, ErrorBox } from "../components/ui";
import SubmissionTable from "../components/SubmissionTable";
import EventList from "../components/EventList";
import Icon from "../components/icons";

export default function MySubmissions() {
  return (
    <Gate>
      <Inner />
    </Gate>
  );
}

function Inner() {
  const { readContract, writeContract, account } = useWeb3();
  const { runTx } = useTx();
  const { data, loading, error } = useAsync(async () => {
    const ids = (await readContract.getResearcherSubmissions(account)).map(Number);
    const subs = (await loadSubmissions(readContract, ids)).sort((a, b) => b.id - a.id);
    const progIds = [...new Set(subs.map((s) => s.programId))];
    const programs = Object.fromEntries(await Promise.all(progIds.map(async (id) => [id, { title: (await readContract.getProgram(id)).title }])));
    const claims = await loadClaims(readContract, account);
    return { subs, programs, claims };
  }, [readContract, account]);
  const { titles, unlock, unlocked } = useTitles(data?.subs.map((s) => s.id));

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const { subs, programs, claims } = data;
  const pending = subs.filter((s) => s.status === "Approved");
  const pendingTotal = pending.reduce((a, s) => a + s.reward, 0n);
  const claimedTotal = subs.filter((s) => s.status === "Claimed").reduce((a, s) => a + s.reward, 0n);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>My submissions</h1>
          <p className="muted">Reports submitted from this wallet. Status and rewards are read from the contract.</p>
        </div>
        <div className="row gap">
          {!unlocked && subs.length > 0 && <button className="btn btn-outline" onClick={() => unlock().catch(() => {})}><Icon name="unlock" size={15} /> Unlock report titles</button>}
          <Link className="btn btn-primary" to="/programs">Find a program</Link>
        </div>
      </div>
      <div className="stats">
        <Stat label="Total reports" value={subs.length} />
        <Stat label="Pending review" value={subs.filter((s) => s.status === "Submitted").length} />
        <Stat label="Approved" value={subs.filter((s) => ["Approved", "Claimed"].includes(s.status)).length} />
        <Stat label="Rejected / disputed" value={subs.filter((s) => ["Rejected", "Disputed", "RejectionUpheld"].includes(s.status)).length} />
        <Stat label="Claimable now" value={fmtEth(pendingTotal)} />
        <Stat label="Earned" value={fmtEth(claimedTotal)} />
      </div>
      <Section title="Submissions">
        <SubmissionTable
          subs={subs}
          titles={titles}
          programs={programs}
          empty="You have not submitted any reports yet."
          actions={(s) =>
            s.status === "Approved" ? (
              <button className="btn btn-primary btn-sm" onClick={() => runTx(`Claim ${fmtEth(s.reward)} for report #${s.id}`, () => writeContract.claimReward(s.id))}>
                Claim
              </button>
            ) : s.status === "Rejected" ? (
              <Link className="btn btn-warn btn-sm" to={`/submissions/${s.id}`}>Dispute</Link>
            ) : null
          }
        />
      </Section>
      <Section title="Reward claim transactions">
        <EventList events={claims} empty="No rewards claimed yet" />
      </Section>
    </div>
  );
}
