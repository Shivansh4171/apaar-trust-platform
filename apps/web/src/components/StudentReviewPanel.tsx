import { useEffect, useState, type FormEvent } from "react";
import { localizeApiMessage, useLanguage } from "../i18n";

type DemoRecord = {
  id: string;
  reference: string;
  fullName: string;
  program: string;
  status: string;
};

type DiscrepancyReport = {
  id: string;
  field: "REFERENCE" | "FULL_NAME" | "PROGRAM";
  institutionValue: string;
  claimedValue: string;
  reason: string;
  status: "OPEN" | "UNDER_REVIEW" | "RESOLVED";
  createdAt: string;
};

export default function StudentReviewPanel() {
  const { locale, t, formatDate } = useLanguage();
  const [records, setRecords] = useState<DemoRecord[]>([]);
  const [recordId, setRecordId] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [report, setReport] = useState<DiscrepancyReport | null>(null);
  const [field, setField] = useState<DiscrepancyReport["field"]>("FULL_NAME");
  const [claimedValue, setClaimedValue] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    async function loadDemoRecords() {
      setLoading(true);
      try {
        const response = await fetch("/api/student/records?page=1&pageSize=50");
        if (!response.ok) throw new Error("Synthetic demo records are unavailable.");
        const data = await response.json() as { records: DemoRecord[] };
        setRecords(data.records);
        setRecordId((current) => current || data.records[0]?.id || "");
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : "Could not load demo records.");
      } finally {
        setLoading(false);
      }
    }
    void loadDemoRecords();
  }, []);

  const selectedRecord = records.find((record) => record.id === recordId);

  async function confirmRecord() {
    if (!selectedRecord) return;
    setBusy(true);
    setError("");
    setMessage("");
    setReport(null);
    try {
      const response = await fetch(`/api/student/records/${selectedRecord.id}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const result = await response.json() as { message?: string };
      if (!response.ok) throw new Error(result.message ?? t("student.confirmError"));
      setMessage(result.message ?? t("student.confirmed"));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("student.confirmError"));
    } finally {
      setBusy(false);
    }
  }

  async function submitDiscrepancy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedRecord) return;
    setBusy(true);
    setError("");
    setMessage("");
    setReport(null);
    try {
      const response = await fetch(`/api/student/records/${selectedRecord.id}/discrepancies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ field, claimedValue, reason }),
      });
      const result = await response.json() as { message?: string; report?: DiscrepancyReport };
      if (!response.ok) throw new Error(result.message ?? t("student.discrepancyError"));
      setReport(result.report ?? null);
      setMessage(result.message ?? t("student.discrepancySubmitted"));
      setClaimedValue("");
      setReason("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("student.discrepancyError"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="message message-notice">
        <strong>{t("student.notice.title")}</strong> {t("student.notice.body")}
      </div>

      {error && <p role="alert" className="message message-error">{localizeApiMessage(error, locale, t("student.discrepancyError"))}</p>}
      {message && <p role="status" className="message message-success">{localizeApiMessage(message, locale, message)}</p>}

      {loading ? (
        <div className="portal-panel empty-state" aria-live="polite">{t("student.loading")}</div>
      ) : records.length === 0 ? (
        <div className="portal-panel empty-state">{t("student.empty")}</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <section className="portal-panel">
            <h2 className="panel-title">{t("student.select")}</h2>
            <label className="sr-only" htmlFor="demo-record">{t("student.select")}</label>
            <select id="demo-record" value={recordId} onChange={(event) => { setRecordId(event.target.value); setMessage(""); setReport(null); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-800 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100">
              {records.map((record) => <option key={record.id} value={record.id}>{record.reference} · {record.fullName}</option>)}
            </select>
            {selectedRecord && (
              <dl className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-100">
                <div className="px-4 py-3"><dt className="text-xs font-medium text-slate-500">{t("student.institutionReference")}</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{selectedRecord.reference}</dd></div>
                <div className="px-4 py-3"><dt className="text-xs font-medium text-slate-500">{t("student.institutionName")}</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{selectedRecord.fullName}</dd></div>
                <div className="px-4 py-3"><dt className="text-xs font-medium text-slate-500">{t("student.institutionProgram")}</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{selectedRecord.program}</dd></div>
                <div className="px-4 py-3"><dt className="text-xs font-medium text-slate-500">{t("student.recordStatus")}</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{t(`status.${selectedRecord.status.toLowerCase()}` as "status.verified" | "status.unverified" | "status.pending" | "status.disputed" | "status.reported")} · {t("student.notOfficial")}</dd></div>
              </dl>
            )}
            <button type="button" onClick={() => void confirmRecord()} disabled={!selectedRecord || busy} className="button button-secondary mt-5 w-full">
              {busy ? t("student.saving") : t("student.confirm")}
            </button>
          </section>

          <section className="portal-panel">
            <h2 className="panel-title">{t("student.form.title")}</h2>
            <p className="panel-description">{t("student.form.description")}</p>
            <form onSubmit={(event) => void submitDiscrepancy(event)} className="mt-5 space-y-4">
              <div>
                <label htmlFor="discrepancy-field">{t("student.field")}</label>
                <select id="discrepancy-field" value={field} onChange={(event) => setField(event.target.value as DiscrepancyReport["field"])} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100">
                  <option value="REFERENCE">{t("field.reference")}</option>
                  <option value="FULL_NAME">{t("field.name")}</option>
                  <option value="PROGRAM">{t("field.program")}</option>
                </select>
              </div>
              <div>
                <label htmlFor="claimed-value">{t("student.claimedValue")}</label>
                <input id="claimed-value" value={claimedValue} onChange={(event) => setClaimedValue(event.target.value)} maxLength={120} required className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </div>
              <div>
                <label htmlFor="discrepancy-reason">{t("student.reason")}</label>
                <textarea id="discrepancy-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={1000} rows={4} required className="mt-1.5 w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100" placeholder={t("student.reason.placeholder")} />
                <p className="mt-1 text-right text-[11px] text-slate-400">{reason.length}/1000</p>
              </div>
              <button type="submit" disabled={!selectedRecord || busy} className="button button-primary button-wide">
                {busy ? t("student.submitting") : t("student.submit")}
              </button>
            </form>
            {report && (
              <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm">
                <p className="font-semibold text-indigo-950">{t("student.reportOpened")} · {t(`status.${report.status === "UNDER_REVIEW" ? "underReview" : report.status.toLowerCase()}` as "status.open" | "status.underReview" | "status.resolved")}</p>
                <dl className="mt-3 space-y-2 text-xs text-slate-700">
                  <div><dt className="inline font-semibold">{t("student.institutionValue")}: </dt><dd className="inline">{report.institutionValue}</dd></div>
                  <div><dt className="inline font-semibold">{t("student.claimedValue")}: </dt><dd className="inline">{report.claimedValue}</dd></div>
                  <div><dt className="inline font-semibold">{t("student.submitted")}: </dt><dd className="inline">{formatDate(report.createdAt)}</dd></div>
                </dl>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
