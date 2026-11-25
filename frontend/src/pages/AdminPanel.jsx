import { useState } from "react";
import { ethers } from "ethers";
import { useWeb3 } from "../context/Web3Context";
import { useTx } from "../context/TxContext";
import { useAsync, loadActivity, usePrograms } from "../lib/hooks";
import { fmtEth, fmtDate, ZERO_ADDR, programPhase } from "../lib/contract";
import { Gate, Section, Stat, Loading, ErrorBox, Addr, Badge, Empty, PhaseBadge } from "../components/ui";
import EventList from "../components/EventList";
import { Link } from "react-router-dom";

export default function AdminPanel() {
  return (
    <Gate need={(r) => r.isAdmin} roleName="Platform Administrator">
      <Inner />
    </Gate>
  );
}

function Inner() {
  const { readContract, writeContract } = useWeb3();
  const { runTx } = useTx();
  const [orgAddr, setOrgAddr] = useState("");
  const [orgName, setOrgName] = useState("");
  const [resolverAddr, setResolverAddr] = useState("");
  const [windowHours, setWindowHours] = useState("");
  const [err, setErr] = useState(null);

  const data = useAsync(async () => {
    const s = await readContract.getStats();
    const addrs = await readContract.getOrganizations();
    const orgs = await Promise.all(addrs.map(async (a) => ({ address: a, ...(await readContract.getOrganization(a)).toObject() })));
    const [resolver, win] = await Promise.all([readContract.disputeResolver(), readContract.disputeWindow()]);
    const activity = await loadActivity(readContract, 40);
    return { stats: s, orgs, resolver, window: Number(win), activity };
  }, [readContract]);
  const programs = usePrograms();

  if (data.loading && !data.data) return <div className="page"><Loading /></div>;
  if (data.error) return <div className="page"><ErrorBox error={data.error} /></div>;
  const { stats, orgs, resolver, activity } = data.data;

  async function registerOrg(e) {
    e.preventDefault();
    setErr(null);
    if (!ethers.isAddress(orgAddr)) return setErr("Invalid organization address.");
    if (orgName.trim().length < 2) return setErr("Organization name required.");
    const r = await runTx(`Register organization "${orgName}"`, () => writeContract.registerOrganization(ethers.getAddress(orgAddr), orgName.trim()));
    if (r) { setOrgAddr(""); setOrgName(""); }
  }
  async function setResolver(e) {
    e.preventDefault();
    setErr(null);
    if (!ethers.isAddress(resolverAddr)) return setErr("Invalid resolver address.");
    const r = await runTx("Set dispute resolver", () => writeContract.setDisputeResolver(ethers.getAddress(resolverAddr)));
    if (r) setResolverAddr("");
  }
  async function setWindow(e) {
    e.preventDefault();
    const h = Number(windowHours);
    if (!(h >= 1 && h <= 2160)) return setErr("Window must be between 1 and 2160 hours.");
    await runTx(`Set dispute window to ${h} h`, () => writeContract.setDisputeWindow(Math.round(h * 3600)));
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Admin panel</h1>
          <p className="muted">Platform administration. The admin cannot review reports or act as dispute resolver (enforced by the contract).</p>
        </div>
      </div>
      <div className="stats">
        <Stat label="Registered organizations" value={Number(stats.orgs)} />
        <Stat label="Bounty programs" value={Number(stats.programs)} />
        <Stat label="Total reports" value={Number(stats.submissions)} />
        <Stat label="Disputes" value={Number(stats.disputes)} />
        <Stat label="Rewards distributed" value={fmtEth(stats.distributed)} />
      </div>
      <ErrorBox error={err} />
      <div className="two-col">
        <div className="col-main">
          <Section title="Organizations">
            <form className="row gap wrap" onSubmit={registerOrg}>
              <input className="input mono grow" placeholder="0x… organization wallet" value={orgAddr} onChange={(e) => setOrgAddr(e.target.value)} />
              <input className="input" placeholder="Organization name" value={orgName} onChange={(e) => setOrgName(e.target.value)} maxLength={120} />
              <button className="btn btn-primary">Register</button>
            </form>
            {orgs.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Name</th><th>Wallet</th><th>Registered</th><th>Status</th><th /></tr></thead>
                  <tbody>
                    {orgs.map((o) => (
                      <tr key={o.address}>
                        <td>{o.name}</td>
                        <td><Addr address={o.address} /></td>
                        <td className="muted">{fmtDate(Number(o.registeredAt))}</td>
                        <td>{o.authorized ? <Badge tone="success">Authorized</Badge> : <Badge tone="danger">Revoked</Badge>}</td>
                        <td>{o.authorized && <button className="btn btn-ghost btn-sm" onClick={() => runTx(`Revoke ${o.name}`, () => writeContract.revokeOrganization(o.address))}>Revoke</button>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <Empty title="No organizations registered yet" icon="building" />
            )}
          </Section>
          <Section title="Bounty programs">
            {programs.data?.length ? (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>#</th><th>Title</th><th>Owner</th><th>Status</th><th>Available</th><th>Reserved</th><th>Reports</th></tr></thead>
                  <tbody>
                    {programs.data.map((p) => (
                      <tr key={p.id}>
                        <td>{p.id}</td>
                        <td><Link to={`/programs/${p.id}`}>{p.title}</Link></td>
                        <td><Addr address={p.owner} /></td>
                        <td><PhaseBadge phase={programPhase(p)} /></td>
                        <td>{fmtEth(p.availableBalance)}</td>
                        <td>{fmtEth(p.reservedBalance)}</td>
                        <td>{p.submissionCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : programs.loading ? <Loading /> : <Empty title="No programs yet" icon="shield" />}
          </Section>
        </div>
        <div className="col-side">
          <Section title="Dispute resolver">
            <p>Current: {resolver !== ZERO_ADDR ? <Addr address={resolver} /> : <Badge tone="warn">not set</Badge>}</p>
            <form className="form" onSubmit={setResolver}>
              <input className="input mono" placeholder="0x… resolver wallet" value={resolverAddr} onChange={(e) => setResolverAddr(e.target.value)} />
              <button className="btn btn-primary btn-sm">Assign resolver</button>
            </form>
            <hr />
            <p>Dispute window: <b>{data.data.window / 3600} hours</b> <span className="muted small">(applies to rejections made after a change)</span></p>
            <form className="row gap" onSubmit={setWindow}>
              <input className="input" type="number" min="1" max="2160" placeholder="hours" value={windowHours} onChange={(e) => setWindowHours(e.target.value)} />
              <button className="btn btn-outline btn-sm">Update</button>
            </form>
          </Section>
          <Section title="Recent platform activity">
            <EventList events={activity} />
          </Section>
        </div>
      </div>
    </div>
  );
}
