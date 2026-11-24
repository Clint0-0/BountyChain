import { useWeb3 } from "../context/Web3Context";
import { useAsync, loadSubmissions, loadDispute } from "../lib/hooks";
import { useTitles } from "../lib/useTitles";
import { Gate, Section, Stat, Loading, ErrorBox } from "../components/ui";
import SubmissionTable from "../components/SubmissionTable";

export default function DisputeDashboard() {
  return (
    <Gate need={(r) => r.isResolver} roleName="Dispute Resolver">
      <Inner />
    </Gate>
  );
}

function Inner() {
  const { readContract } = useWeb3();
  const { data, loading, error } = useAsync(async () => {
    const ids = (await readContract.getDisputedSubmissions()).map(Number);
    const subs = await loadSubmissions(readContract, ids);
    const disputes = Object.fromEntries(await Promise.all(ids.map(async (id) => [id, await loadDispute(readContract, id)])));
    const progIds = [...new Set(subs.map((s) => s.programId))];
    const programs = Object.fromEntries(await Promise.all(progIds.map(async (id) => [id, { title: (await readContract.getProgram(id)).title }])));
    return { subs: subs.sort((a, b) => b.id - a.id), disputes, programs };
  }, [readContract]);
  const { titles, unlock, unlocked } = useTitles(data?.subs.map((s) => s.id));

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const open = data.subs.filter((s) => data.disputes[s.id].status === "Open");
  const closed = data.subs.filter((s) => data.disputes[s.id].status !== "Open");
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Dispute resolution</h1>
          <p className="muted">Researchers can dispute rejected reports. Your final decision is written to the contract.</p>
        </div>
        {!unlocked && data.subs.length > 0 && <button className="btn btn-outline" onClick={() => unlock().catch(() => {})}>🔓 Unlock report titles</button>}
      </div>
      <div className="stats">
        <Stat label="Open disputes" value={open.length} />
        <Stat label="Overturned" value={closed.filter((s) => data.disputes[s.id].status === "Overturned").length} />
        <Stat label="Upheld" value={closed.filter((s) => data.disputes[s.id].status === "Upheld").length} />
      </div>
      <Section title="Pending disputes">
        <SubmissionTable subs={open} titles={titles} programs={data.programs} empty="No open disputes." />
      </Section>
      <Section title="Dispute history">
        <SubmissionTable subs={closed} titles={titles} programs={data.programs} empty="No resolved disputes yet." />
      </Section>
    </div>
  );
}
