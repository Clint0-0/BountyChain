import { Routes, Route, Link } from "react-router-dom";
import Layout from "./components/Layout";
import Toasts from "./components/Toasts";
import Home from "./pages/Home";
import Programs from "./pages/Programs";
import ProgramDetail from "./pages/ProgramDetail";
import SubmissionDetail from "./pages/SubmissionDetail";
import MySubmissions from "./pages/MySubmissions";
import OrgDashboard from "./pages/OrgDashboard";
import VerifierDashboard from "./pages/VerifierDashboard";
import DisputeDashboard from "./pages/DisputeDashboard";
import AdminPanel from "./pages/AdminPanel";
import { useWeb3 } from "./context/Web3Context";
import { Empty } from "./components/ui";

export default function App() {
  const { error, setError } = useWeb3();
  return (
    <>
      <Layout>
      {error && (
        <div className="banner">
          {error} <button className="btn btn-ghost btn-sm" onClick={() => setError(null)}>×</button>
        </div>
      )}
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/programs" element={<Programs />} />
          <Route path="/programs/:id" element={<ProgramDetail />} />
          <Route path="/submissions" element={<MySubmissions />} />
          <Route path="/submissions/:id" element={<SubmissionDetail />} />
          <Route path="/organization" element={<OrgDashboard />} />
          <Route path="/verifier" element={<VerifierDashboard />} />
          <Route path="/disputes" element={<DisputeDashboard />} />
          <Route path="/admin" element={<AdminPanel />} />
          <Route path="*" element={<div className="page"><Empty title="Page not found" icon="alert"><Link to="/">Go home</Link></Empty></div>} />
        </Routes>
      </Layout>
      <Toasts />
    </>
  );
}
