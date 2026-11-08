import { useEffect, useMemo, useState } from "react";
import { deskApi, type QuoteServiceOut } from "../../api";
import { Card, FormField, buttonClass, inputClass } from "../../ui";
import { messageOf } from "../comms/lib/messages";
import { ServiceCheckout } from "../comms/ServiceCheckout";
import { DownloadCard } from "./DownloadCard";
import { COMPLIANCE_REPORT_TYPES, defaultReportMonth, recentMonths, reportMonthLabel } from "./complianceLogic";

/**
 * A paid desk service (never free, Plot Yangu customers only): choose the customer's property, month and report, pay KES 200 by M-PESA,
 * and the download appears only after the payment is confirmed and the report has been made.
 */
export function ComplianceReportCard({ sessionId }: { sessionId: string }) {
  const [properties, setProperties] = useState<{ id: string; name: string }[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [propertyId, setPropertyId] = useState("");
  const [month, setMonth] = useState(defaultReportMonth());
  const [reportType, setReportType] = useState<(typeof COMPLIANCE_REPORT_TYPES)[number]["id"]>("mri_monthly");
  const [quote, setQuote] = useState<QuoteServiceOut | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const months = useMemo(() => recentMonths(24), []);
  const chosen = COMPLIANCE_REPORT_TYPES.find((t) => t.id === reportType);

  useEffect(() => {
    let live = true;
    deskApi.reportProperties({ sessionId })
      .then((r) => { if (!live) return; setProperties(r.properties); setPropertyId((cur) => cur || r.properties[0]?.id || ""); })
      .catch((e) => { if (live) setLoadError(messageOf(e)); });
    return () => { live = false; };
  }, [sessionId]);

  async function check() {
    setBusy(true); setError(null);
    try { setQuote(await deskApi.quoteService({ sessionId, serviceType: "compliance_report", params: { reportType, propertyId, month } })); }
    catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }

  if (quote) {
    const propName = properties?.find((p) => p.id === propertyId)?.name ?? propertyId;
    return (
      <ServiceCheckout
        sessionId={sessionId} quote={quote} label={chosen?.title ?? "Compliance report"} doneText="Your report is ready."
        details={<><p><span className="font-semibold">Report:</span> {chosen?.title}</p><p className="mt-1"><span className="font-semibold">Property:</span> {propName}</p><p className="mt-1"><span className="font-semibold">Month:</span> {reportMonthLabel(month)}</p></>}
        saveDraft={async () => undefined}
        doneContent={(t) => (t.file
          ? <DownloadCard title={`${chosen?.title ?? "Report"} · ${propName} · ${reportMonthLabel(month)}`} url={t.file.downloadUrl} expiresAt={t.file.expiresAt} />
          : <p className="text-sm text-gray-700">The report is being prepared. This page updates by itself.</p>)}
        onReset={() => { setQuote(null); setError(null); }}
      />
    );
  }
  return (
    <Card title="Compliance report (paid)">
      <div className="min-w-0 space-y-4">
        <p className="break-words text-sm text-gray-700">MRI working paper or annual rental income summary for one of the customer's properties. KES 200 per report, paid by M-PESA. The file is released only after payment is confirmed.</p>
        {loadError && <p role="alert" className="break-words text-sm text-red-700">{loadError}</p>}
        {properties && properties.length === 0 && <p className="break-words text-sm text-amber-800">This customer has no Plot Yangu properties with synced records. Ask them to turn on cloud sync first.</p>}
        {properties && properties.length > 0 && (
          <>
            <FormField label="Property" htmlFor="cr-property">
              <select id="cr-property" className={inputClass} value={propertyId} onChange={(e) => setPropertyId(e.target.value)} disabled={busy}>
                {properties.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </FormField>
            <FormField label={reportType === "annual_summary" ? "Year to month" : "Month the rent was received"} htmlFor="cr-month">
              <select id="cr-month" className={inputClass} value={month} onChange={(e) => setMonth(e.target.value)} disabled={busy}>
                {months.map((m) => <option key={m} value={m}>{reportMonthLabel(m)}</option>)}
              </select>
            </FormField>
            <fieldset className="min-w-0 space-y-2">
              <legend className="text-sm font-medium text-gray-700">Report</legend>
              {COMPLIANCE_REPORT_TYPES.map((t) => (
                <label key={t.id} className={`flex min-w-0 cursor-pointer gap-3 rounded-xl border p-3 text-sm ${reportType === t.id ? "border-blue-500 bg-blue-50" : "border-gray-200"}`}>
                  <input type="radio" name="cr-type" checked={reportType === t.id} onChange={() => setReportType(t.id)} className="mt-1" />
                  <span className="min-w-0"><span className="block font-semibold text-gray-900">{t.title}</span><span className="block break-words text-gray-600">{t.blurb}</span></span>
                </label>
              ))}
            </fieldset>
            {error && <p role="alert" className="break-words text-sm text-red-700">{error}</p>}
            <button type="button" className={buttonClass.primary} disabled={!propertyId || busy} onClick={() => void check()}>{busy ? "Checking…" : "Check records and get the price"}</button>
          </>
        )}
        {!properties && !loadError && <p role="status" className="text-sm text-gray-500">Loading the customer's properties…</p>}
      </div>
    </Card>
  );
}
