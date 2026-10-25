import { useEffect, useState } from "react";
import { demoInstitutionCode } from "../demo-config";

type ReviewStatus = "OPEN" | "UNDER_REVIEW" | "RESOLVED";
type Discrepancy = {
  id: string;
  field: "REFERENCE" | "FULL_NAME" | "PROGRAM";
  institutionValue: string;
  claimedValue: string;
  reason: string;
  status: ReviewStatus;
  resolutionNote: string | null;
  createdAt: string;
  updatedAt: string;
  studentRecord: { reference: string; fullName: string; program: string };
  history: Array<{
    id: string;
    actor: "STUDENT_DEMO" | "INSTITUTION_DEMO";
    action: "SUBMITTED" | "REVIEW_UPDATED";
    fromStatus: ReviewStatus | null;
    toStatus: ReviewStatus;
    note: string | null;
    createdAt: string;
  }>;
};

const fieldLabels: Record<Discrepancy["field"], string> = {
  REFERENCE: "Student reference",
  FULL_NAME: "Student name",
  PROGRAM: "Program",
};

export default function InstitutionDiscrepancyPanel() {
  const [reports, setReports] = useState<Discrepancy[]>([]);
  const [statusFilter, setStatusFilter] = useState<"ALL" | ReviewStatus>("OPEN");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function loadReports(filter: "ALL" | ReviewStatus) {
    setLoading(true);
    setError("");
    try {
      const query = filter === "ALL" ? "" : `?status=${filter}`;
      const response = await fetch(`/api/institution/discrepancies${query}`, {
        headers: { "X-Institution-Code": demoInstitutionCode },
      });
      const result = await response.json() as { reports?: Discrepancy[]; message?: string };
      if (!response.ok) throw new Error(result.message ?? "Could not load discrepancy reports.");
      setReports(result.reports ?? []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load discrepancy reports.");
      setReports([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReports(statusFilter);
  }, [statusFilter]);

  async function updateReport(reportId: string, status: "UNDER_REVIEW" | "RESOLVED") {
    const resolutionNote = notes[reportId]?.trim() ?? "";
    setSaving(reportId);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/institution/discrepancies/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Institution-Code": demoInstitutionCode },
        body: JSON.stringify({ status, resolutionNote }),
      });
      const result = await response.json() as { report?: Discrepancy; message?: string };
      if (!response.ok || !result.report) throw new Error(result.message ?? "Could not save the review update.");
      setReports((current) => current.map((report) => report.id === reportId ? result.report! : report));
      setMessage(`Report ${result.report.status.toLowerCase()} with an audit note.`);
      setNotes((current) => ({ ...current, [reportId]: "" }));
      if (statusFilter !== "ALL" && status !== statusFilter) {
        setReports((current) => current.filter((report) => report.id !== reportId));
      }
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Could not save the review update.");
    } finally {
      setSaving("");
    }
  }

  return (
    <section className="space-y-5">
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950 sm:p-6">
        <strong>Prototype reviewer view.</strong> The demo institution code scopes reports, but is not authentication. Review actions are recorded as demo actions, not verified staff decisions.
      </div>
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-900">{message}</p>}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-xl font-semibold text-slate-950">Discrepancy reports</h2>
          <p className="mt-1 text-sm text-slate-600">Original institution values and student claims remain separately visible.</p>
        </div>
        <div>
          <label htmlFor="review-status-filter" className="block text-xs font-semibold text-slate-600">Filter status</label>
          <select id="review-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | ReviewStatus)} className="mt-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="OPEN">Open</option>
            <option value="UNDER_REVIEW">Under review</option>
            <option value="RESOLVED">Resolved</option>
            <option value="ALL">All statuses</option>
          </select>
        </div>
      </div>

      {loading ? <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading discrepancy reports…</div>
        : reports.length === 0 ? <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">No reports match this filter.</div>
          : reports.map((report) => (
            <article key={report.id} aria-label={`Discrepancy report ${report.studentRecord.reference}`} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{fieldLabels[report.field]} · {report.studentRecord.reference}</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-950">{report.studentRecord.fullName}</h3>
                  <p className="mt-1 text-xs text-slate-500">Submitted {new Date(report.createdAt).toLocaleString()}</p>
                </div>
                <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-900">{report.status.replace("_", " ").toLowerCase()}</span>
              </div>

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-semibold text-slate-500">Institution-reported value · preserved</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-900">{report.institutionValue}</dd></div>
                <div className="rounded-2xl bg-indigo-50 p-4"><dt className="text-xs font-semibold text-indigo-700">Student-claimed value</dt><dd className="mt-1 break-words text-sm font-semibold text-indigo-950">{report.claimedValue}</dd></div>
              </dl>
              <div className="mt-3 rounded-2xl border border-slate-100 px-4 py-3"><p className="text-xs font-semibold text-slate-500">Student’s reason</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{report.reason}</p></div>

              {report.status !== "RESOLVED" && (
                <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <label htmlFor={`review-note-${report.id}`} className="block text-xs font-semibold text-slate-700">Demo reviewer note (5–1000 characters)</label>
                  <textarea id={`review-note-${report.id}`} value={notes[report.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value }))} minLength={5} maxLength={1000} rows={2} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button type="button" disabled={saving === report.id || (notes[report.id]?.trim().length ?? 0) < 5} onClick={() => void updateReport(report.id, "UNDER_REVIEW")} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Mark under review</button>
                    <button type="button" disabled={saving === report.id || (notes[report.id]?.trim().length ?? 0) < 5} onClick={() => void updateReport(report.id, "RESOLVED")} className="rounded-xl bg-indigo-700 px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">Resolve report</button>
                  </div>
                </div>
              )}
              {report.resolutionNote && <p className="mt-4 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-900"><strong>Latest reviewer note:</strong> {report.resolutionNote}</p>}

              <details className="mt-4 border-t border-slate-100 pt-4">
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">Audit history ({report.history.length} events)</summary>
                <ol className="mt-3 space-y-3">
                  {report.history.map((event) => (
                    <li key={event.id} className="border-l-2 border-indigo-100 pl-3 text-xs text-slate-600">
                      <p className="font-semibold text-slate-800">{event.actor === "STUDENT_DEMO" ? "Student demo submission" : "Institution demo review"} · {event.fromStatus ? `${event.fromStatus.toLowerCase()} → ` : ""}{event.toStatus.toLowerCase()}</p>
                      <p className="mt-0.5">{new Date(event.createdAt).toLocaleString()}</p>
                      {event.note && <p className="mt-1 leading-5">{event.note}</p>}
                    </li>
                  ))}
                </ol>
              </details>
            </article>
          ))}
    </section>
  );
}
