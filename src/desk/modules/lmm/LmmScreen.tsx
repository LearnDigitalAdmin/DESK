import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";
import { EmptyState, Page, cn } from "../../ui";
import { useAgent } from "../../core/useAgent";
import AddTenantWizard from "./AddTenantWizard";
import Earnings from "./Earnings";
import Pipeline from "./Pipeline";
import TenantDetail from "./TenantDetail";
import TenantsList from "./TenantsList";
import WaitingScreen from "./WaitingScreen";
import { LMM_BASE } from "./logic.ts";
import { Spinner } from "./parts";
import { S } from "./strings.ts";

const tab = ({ isActive }: { isActive: boolean }) =>
  cn("inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold", isActive ? "bg-blue-600 text-white" : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50");

function Detail() {
  const { tenantId = "" } = useParams();
  return <TenantDetail tenantId={tenantId} backTo={LMM_BASE} backLabel={S.nav.tenants} />;
}

function Home() {
  return (
    <Page title={S.brand} subtitle={S.moduleDescription}>
      <nav aria-label={S.brand} className="flex min-w-0 flex-wrap gap-2">
        <NavLink to={LMM_BASE} end className={tab}>{S.nav.tenants}</NavLink>
        <NavLink to={`${LMM_BASE}/new`} className={tab}>{S.nav.add}</NavLink>
        <NavLink to={`${LMM_BASE}/earnings`} className={tab}>{S.nav.earnings}</NavLink>
        <NavLink to={`${LMM_BASE}/pipeline`} className={tab}>{S.nav.pipeline}</NavLink>
      </nav>
      <Routes>
        <Route index element={<TenantsList detailBase={LMM_BASE} />} />
        <Route path="new" element={<AddTenantWizard />} />
        <Route path="earnings" element={<Earnings />} />
        <Route path="pipeline" element={<Pipeline />} />
        <Route path="*" element={<Navigate to={LMM_BASE} replace />} />
      </Routes>
    </Page>
  );
}

/** The desk agent's Lipa Mdogo Mdogo area. The server decides what each person may see; this only lays the screens out. */
export default function LmmScreen() {
  const agent = useAgent();
  if (agent === undefined) return <Spinner />;
  if (agent === null) return <Page title={S.brand}><EmptyState title={S.denied.title} body={S.denied.body} /></Page>;
  return (
    <Routes>
      <Route path="tenant/:tenantId" element={<Detail />} />
      <Route path="waiting/:tenantId" element={<WaitingScreen />} />
      <Route path="*" element={<Home />} />
    </Routes>
  );
}
