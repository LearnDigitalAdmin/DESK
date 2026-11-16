import { NavLink, Navigate, Route, Routes, useParams } from "react-router-dom";
import { DESK_TOP_CODE } from "../../api";
import { useAgent } from "../../core/useAgent";
import { EmptyState, Page, cn } from "../../ui";
import { LMM_TOP_BASE } from "../lmm/logic.ts";
import { Spinner } from "../lmm/parts";
import TenantDetail from "../lmm/TenantDetail";
import TenantsList from "../lmm/TenantsList";
import AuditViewer from "./AuditViewer";
import LeadsCrm from "./LeadsCrm";
import ReviewQueue from "./ReviewQueue";
import StatsView from "./StatsView";
import TopTenantActions from "./TopTenantActions";
import { TopProvider } from "./TopContext";
import { T } from "./strings.ts";

const tab = ({ isActive }: { isActive: boolean }) =>
  cn("inline-flex h-11 items-center rounded-xl px-4 text-sm font-semibold", isActive ? "bg-blue-600 text-white" : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50");

function Detail() {
  const { tenantId = "" } = useParams();
  return <TenantDetail tenantId={tenantId} backTo={`${LMM_TOP_BASE}/tenants`} backLabel={T.tabs.tenants} allowEdit={false} topActions={(t, reload) => <TopTenantActions tenant={t} reload={reload} />} />;
}

function Tabs() {
  return (
    <Page title={T.title} subtitle={T.subtitle}>
      <nav aria-label={T.title} className="flex min-w-0 flex-wrap gap-2">
        <NavLink to={LMM_TOP_BASE} end className={tab}>{T.tabs.review}</NavLink>
        <NavLink to={`${LMM_TOP_BASE}/tenants`} className={tab}>{T.tabs.tenants}</NavLink>
        <NavLink to={`${LMM_TOP_BASE}/audit`} className={tab}>{T.tabs.audit}</NavLink>
        <NavLink to={`${LMM_TOP_BASE}/leads`} className={tab}>{T.tabs.leads}</NavLink>
        <NavLink to={`${LMM_TOP_BASE}/stats`} className={tab}>{T.tabs.stats}</NavLink>
      </nav>
      <Routes>
        <Route index element={<ReviewQueue />} />
        <Route path="tenants" element={<TenantsList detailBase={LMM_TOP_BASE} showDesk />} />
        <Route path="audit" element={<AuditViewer />} />
        <Route path="leads" element={<LeadsCrm />} />
        <Route path="stats" element={<StatsView />} />
        <Route path="*" element={<Navigate to={LMM_TOP_BASE} replace />} />
      </Routes>
    </Page>
  );
}

/** The top desk's Lipa Mdogo Mdogo console. Hiding it is cosmetic: every lmmx_top_* call is enforced on the server. */
export default function TopLmmScreen() {
  const agent = useAgent();
  if (agent === undefined) return <Spinner />;
  if (agent?.agentCode !== DESK_TOP_CODE) return <Page title={T.title}><EmptyState title={T.denied.title} body={T.denied.body} /></Page>;
  return (
    <TopProvider>
      <Routes>
        <Route path="tenant/:tenantId" element={<Detail />} />
        <Route path="*" element={<Tabs />} />
      </Routes>
    </TopProvider>
  );
}
