import { EXPORT_KINDS, type SessionView } from "../../api";
import { EmptyState, Page } from "../../ui";
import { hasScope, useDeskSession } from "../comms/lib/useDeskSession";
import { useEntityInfo } from "../comms/lib/useEntityInfo";
import { EntityInfoNotice, ScopeNotice, SessionNotice } from "../comms/lib/SessionNotice";
import { ExportCard } from "./ExportCard";
import { offeredExportKinds } from "./reportLogic";
import { RunReportCard } from "./RunReportCard";
import { ComplianceReportCard } from "./ComplianceReportCard";

export default function ReportsScreen() {
  const s = useDeskSession();
  return (
    <Page title="Reports" subtitle="Run the customer's reports and download their data.">
      {s.kind === "ready" ? <Ready session={s.session} /> : <SessionNotice state={s} />}
    </Page>
  );
}

function Ready({ session }: { session: SessionView }) {
  const entity = useEntityInfo(session.sessionId);
  if (entity.status !== "ready") return <EntityInfoNotice state={entity} />;
  const reportTypes = entity.info.reportTypes;
  const kinds = offeredExportKinds(entity.info.exportKinds, EXPORT_KINDS);
  const compliance = session.entityKey.startsWith("pms:");     // compliance reports: Plot Yangu customers only, always paid
  // Actions the customer's account does not offer are not shown at all.
  if (reportTypes.length === 0 && kinds.length === 0 && !compliance) {
    return <EmptyState title="No reports or exports here" body="This customer's account doesn't offer any reports or data exports yet." />;
  }
  return (
    <>
      {compliance && (hasScope(session, "report")
        ? <ComplianceReportCard key={`cr-${session.sessionId}`} sessionId={session.sessionId} />
        : <ScopeNotice scope="Reports" what="compliance reports" />)}
      {reportTypes.length > 0 && (hasScope(session, "report")
        ? <RunReportCard key={session.sessionId} sessionId={session.sessionId} reportTypes={reportTypes} />
        : <ScopeNotice scope="Reports" what="reports" />)}
      {kinds.length > 0 && (hasScope(session, "export")
        ? <ExportCard key={session.sessionId} sessionId={session.sessionId} kinds={kinds} />
        : <ScopeNotice scope="Export" what="exports" />)}
    </>
  );
}
