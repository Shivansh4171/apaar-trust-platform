import { useCallback, useEffect, useState } from "react";
import { localizeApiMessage, useLanguage } from "../i18n";
import RecordCorrectionHistory from "./RecordCorrectionHistory";

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
  studentRecord: { id: string; reference: string; fullName: string; program: string; institution: { id: string; code: string; name: string } };
  history: Array<{
    id: string;
    actor: "STUDENT_DEMO" | "INSTITUTION_DEMO" | "AICTE_ADMIN" | "INSTITUTION_ADMIN" | "INSTITUTION_OPERATOR" | "STUDENT" | "REVIEWER";
    action: "SUBMITTED" | "REVIEW_UPDATED";
    fromStatus: ReviewStatus | null;
    toStatus: ReviewStatus;
    note: string | null;
    createdAt: string;
    actorUser: { email: string } | null;
  }>;
};

type FilterOptions = {
  institutions: Array<{ id: string; code: string; name: string }>;
  programs: string[];
};

function actorLabel(actor: Discrepancy["history"][number]["actor"], t: ReturnType<typeof useLanguage>["t"]) {
  switch (actor) {
    case "STUDENT": case "STUDENT_DEMO": return t("actor.student");
    case "AICTE_ADMIN": return t("actor.aicte");
    case "INSTITUTION_ADMIN": return t("actor.institutionAdmin");
    case "INSTITUTION_OPERATOR": return t("actor.institutionOperator");
    case "REVIEWER": return t("actor.reviewer");
    case "INSTITUTION_DEMO": return t("actor.institutionDemo");
  }
}

export default function InstitutionDiscrepancyPanel({ canReview, crossInstitution = false }: { canReview: boolean; crossInstitution?: boolean }) {
  const { locale, t, formatDate } = useLanguage();
  const [reports, setReports] = useState<Discrepancy[]>([]);
  const [statusFilter, setStatusFilter] = useState<"ALL" | ReviewStatus>("OPEN");
  const [institutionFilter, setInstitutionFilter] = useState("ALL");
  const [programFilter, setProgramFilter] = useState("ALL");
  const [options, setOptions] = useState<FilterOptions>({ institutions: [], programs: [] });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const loadReports = useCallback(async (status: "ALL" | ReviewStatus, institutionId: string, program: string) => {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (status !== "ALL") query.set("status", status);
      if (institutionId !== "ALL") query.set("institutionId", institutionId);
      if (program !== "ALL") query.set("program", program);
      const response = await fetch(`/api/institution/discrepancies${query.size ? `?${query}` : ""}`);
      const result = await response.json() as { reports?: Discrepancy[]; options?: FilterOptions; message?: string };
      if (!response.ok) throw new Error(result.message ?? "Could not load discrepancy reports.");
      setReports(result.reports ?? []);
      setOptions(result.options ?? { institutions: [], programs: [] });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load discrepancy reports.");
      setReports([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReports(statusFilter, institutionFilter, programFilter);
  }, [loadReports, statusFilter, institutionFilter, programFilter]);

  async function updateReport(reportId: string, status: "UNDER_REVIEW" | "RESOLVED") {
    const resolutionNote = notes[reportId]?.trim() ?? "";
    setSaving(reportId);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/institution/discrepancies/${reportId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, resolutionNote }),
      });
      const result = await response.json() as { report?: Discrepancy; message?: string };
      if (!response.ok || !result.report) throw new Error(result.message ?? t("review.saveError"));
      setReports((current) => current.map((report) => report.id === reportId ? result.report! : report));
      const savedStatus = result.report.status === "UNDER_REVIEW" ? t("status.underReview") : t("status.resolved");
      setMessage(t("review.updated", { status: savedStatus }));
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
      <div className="message message-notice">
        <strong>{t("review.notice.title")}</strong> {t("review.notice.body")}
      </div>
      {error && <p role="alert" className="message message-error">{localizeApiMessage(error, locale, t("review.apiLoadError"))}</p>}
      {message && <p role="status" className="message message-success">{message}</p>}

      <div className="review-tools">
        <div className="flex flex-wrap items-end gap-3">
          {crossInstitution && <div>
            <label htmlFor="review-institution-filter">{t("review.filter.institution")}</label>
            <select id="review-institution-filter" value={institutionFilter} onChange={(event) => { setInstitutionFilter(event.target.value); setProgramFilter("ALL"); }} className="mt-1 max-w-64 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="ALL">{t("review.filter.allInstitutions")}</option>
              {options.institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name}</option>)}
            </select>
          </div>}
          <div>
            <label htmlFor="review-program-filter">{t("review.filter.program")}</label>
            <select id="review-program-filter" value={programFilter} onChange={(event) => setProgramFilter(event.target.value)} className="mt-1 max-w-56 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
              <option value="ALL">{t("review.filter.allPrograms")}</option>
              {options.programs.map((program) => <option key={program} value={program}>{program}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="review-status-filter">{t("review.filter.status")}</label>
            <select id="review-status-filter" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as "ALL" | ReviewStatus)} className="mt-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm">
            <option value="OPEN">{t("status.open")}</option>
            <option value="UNDER_REVIEW">{t("status.underReview")}</option>
            <option value="RESOLVED">{t("status.resolved")}</option>
            <option value="ALL">{t("review.filter.allStatuses")}</option>
            </select>
          </div>
        </div>
      </div>

      {loading ? <div className="portal-panel empty-state" aria-live="polite">{t("review.loading")}</div>
        : reports.length === 0 ? <div className="portal-panel empty-state">{t("review.empty")}</div>
          : reports.map((report) => (
            <article key={report.id} aria-label={t("review.case", { reference: report.studentRecord.reference })} className="portal-panel review-case">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-indigo-700">{t(report.field === "REFERENCE" ? "field.reference" : report.field === "FULL_NAME" ? "field.name" : "field.program")} · {report.studentRecord.reference}</p>
                  <h3 className="mt-1 text-base font-semibold text-slate-950">{report.studentRecord.fullName}</h3>
                  <p className="mt-1 text-xs text-slate-500">{report.studentRecord.institution.name} · {report.studentRecord.program}</p>
                  <p className="mt-1 text-xs text-slate-500">{t("review.submitted")} {formatDate(report.createdAt)} · {t("review.assignee")}</p>
                </div>
                <span className={`status-pill status-${report.status.toLowerCase().replace("_", "-")}`}>{t(report.status === "UNDER_REVIEW" ? "status.underReview" : report.status === "RESOLVED" ? "status.resolved" : "status.open")}</span>
              </div>

              <dl className="mt-5 grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl bg-slate-50 p-4"><dt className="text-xs font-semibold text-slate-500">{t("review.institutionValue")}</dt><dd className="mt-1 break-words text-sm font-semibold text-slate-900">{report.institutionValue}</dd></div>
                <div className="rounded-2xl bg-indigo-50 p-4"><dt className="text-xs font-semibold text-indigo-700">{t("review.claimedValue")}</dt><dd className="mt-1 break-words text-sm font-semibold text-indigo-950">{report.claimedValue}</dd></div>
              </dl>
              <div className="mt-3 rounded-2xl border border-slate-100 px-4 py-3"><p className="text-xs font-semibold text-slate-500">{t("review.studentReason")}</p><p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{report.reason}</p></div>
              <RecordCorrectionHistory recordId={report.studentRecord.id} reference={report.studentRecord.reference} />

              {canReview && report.status !== "RESOLVED" && (
                <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <label htmlFor={`review-note-${report.id}`}>{t("review.noteLabel")}</label>
                  <textarea id={`review-note-${report.id}`} value={notes[report.id] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [report.id]: event.target.value }))} minLength={5} maxLength={1000} rows={2} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <button type="button" disabled={saving === report.id || (notes[report.id]?.trim().length ?? 0) < 5} onClick={() => void updateReport(report.id, "UNDER_REVIEW")} className="button button-secondary">{t("review.mark")}</button>
                    <button type="button" disabled={saving === report.id || (notes[report.id]?.trim().length ?? 0) < 5} onClick={() => void updateReport(report.id, "RESOLVED")} className="button button-primary">{t("review.resolve")}</button>
                  </div>
                </div>
              )}
              {report.resolutionNote && <p className="mt-4 rounded-xl bg-green-50 px-4 py-3 text-sm text-green-900"><strong>{t("review.latestNote")}</strong> {report.resolutionNote}</p>}

              <details className="mt-4 border-t border-slate-100 pt-4">
                <summary className="cursor-pointer text-xs font-semibold text-slate-600">{t("review.history", { count: report.history.length })}</summary>
                <ol className="mt-3 space-y-3">
                  {report.history.map((event) => (
                    <li key={event.id} className="border-l-2 border-indigo-100 pl-3 text-xs text-slate-600">
                          <p className="font-semibold text-slate-800">{actorLabel(event.actor, t)} · {event.fromStatus ? `${t(event.fromStatus === "UNDER_REVIEW" ? "status.underReview" : event.fromStatus === "RESOLVED" ? "status.resolved" : "status.open")} → ` : ""}{t(event.toStatus === "UNDER_REVIEW" ? "status.underReview" : event.toStatus === "RESOLVED" ? "status.resolved" : "status.open")}</p>
                      <p className="mt-0.5">{formatDate(event.createdAt)}</p>
                      {event.actorUser && <p className="mt-0.5">{t("review.account")} {event.actorUser.email}</p>}
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
