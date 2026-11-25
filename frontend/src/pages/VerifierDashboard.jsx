import { useWeb3 } from "../context/Web3Context";
import { useAsync, loadProgram, loadSubmissions } from "../lib/hooks";
import { useTitles } from "../lib/useTitles";
import { Gate, Section, Stat, Loading, ErrorBox } from "../components/ui";
import SubmissionTable from "../components/SubmissionTable";
import ProgramCard from "../components/ProgramCard";
import Icon from "../components/icons";

export default function VerifierDashboard() {
  return (
    <Gate need={(r) => r.isVerifier} roleName="Verifier">
      <Inner />
    </Gate>
  );
}

function Inner() {
  const { readContract, account } = useWeb3();
  const { data, loading, error } = useAsync(async () => {
    const pids = (await readContract.getVerifierPrograms(account)).map(Number);
    const programs = await Promise.all(pids.map((id) => loadProgram(readContract, id)));
    const subIds = (await Promise.all(pids.map((id) => readContract.getProgramSubmissions(id)))).flat().map(Number);
    const subs = (await loadSubmissions(readContract, subIds)).sort((a, b) => b.id - a.id);
    return { programs, subs, progMap: Object.fromEntries(programs.map((p) => [p.id, p])) };
  }, [readContract, account]);
  const { titles, unlock, unlocked } = useTitles(data?.subs.map((s) => s.id));

  if (loading && !data) return <div className="page"><Loading /></div>;
  if (error) return <div className="page"><ErrorBox error={error} /></div>;
  const pending = data.subs.filter((s) => s.status === "Submitted");
  const reviewed = data.subs.filter((s) => s.status !== "Submitted");
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Verifier dashboard</h1>
          <p className="muted">Review reports for programs you are assigned to. Your decision is recorded on-chain.</p>
        </div>
        {!unlocked && data.subs.length > 0 && <button className="btn btn-outline" onClick={() => unlock().catch(() => {})}><Icon name="unlock" size={15} /> Unlock report titles</button>}
      </div>
      <div className="stats">
        <Stat label="Assigned programs" value={data.programs.length} />
        <Stat label="Pending review" value={pending.length} />
        <Stat label="Reviewed" value={reviewed.length} />
      </div>
      <Section title="Pending submissions">
        <SubmissionTable subs={pending} titles={titles} programs={data.progMap} empty="Nothing waiting for review" />
      </Section>
      <Section title="Assigned programs">
        <div className="grid-cards">
          {data.programs.map((p) => <ProgramCard key={p.id} p={p} />)}
        </div>
      </Section>
      <Section title="Review history">
        <SubmissionTable subs={reviewed} titles={titles} programs={data.progMap} empty="No reviewed submissions yet." />
      </Section>
    </div>
  );
}
