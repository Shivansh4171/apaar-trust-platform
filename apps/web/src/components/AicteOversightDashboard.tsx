import { useEffect, useState } from "react";
import { localizeApiMessage, useLanguage } from "../i18n";
import DataQualityFindings, { type DataQualityFinding } from "./DataQualityFindings";

type ReviewStatus = "ALL" | "OPEN" | "UNDER_REVIEW" | "RESOLVED";
type MetricCounts = {
  totalRecords: number;
  reported: number;
  confirmed: number;
  pending: number;
  disputed: number;
  recordStatusDisputed: number;
  activeDiscrepancyRecords: number;
  unverified: number;
};
type OversightRow = MetricCounts & { institutionId: string; code: string; name: string };
type OversightResponse = {
  rows: OversightRow[];
  totals: MetricCounts;
  options: {
    institutions: Array<{ id: string; code: string; name: string }>;
    programs: string[];
    reviewStatuses: ReviewStatus[];
    academicYearAvailable: boolean;
  };
  metricDefinitions: Record<Exclude<keyof MetricCounts, "totalRecords">, string>;
  notice: string;
  qualityFindings: DataQualityFinding[];
  qualityRulePolicy: { approvedIntakeAvailable: boolean };
};

const metricLabels: Array<Exclude<keyof MetricCounts, "totalRecords" | "recordStatusDisputed" | "activeDiscrepancyRecords">> = ["reported", "confirmed", "pending", "disputed", "unverified"];

export default function AicteOversightDashboard() {
  const { locale, t } = useLanguage();
  const [institutionId, setInstitutionId] = useState("ALL");
  const [program, setProgram] = useState("ALL");
  const [reviewStatus, setReviewStatus] = useState<ReviewStatus>("ALL");
  const [data, setData] = useState<OversightResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const query = new URLSearchParams();
    if (institutionId !== "ALL") query.set("institutionId", institutionId);
    if (program !== "ALL") query.set("program", program);
    if (reviewStatus !== "ALL") query.set("reviewStatus", reviewStatus);

    let active = true;
    setLoading(true);
    setError("");
    fetch(`/api/aicte/oversight${query.size ? `?${query}` : ""}`)
      .then(async (response) => {
        const result = await response.json() as OversightResponse & { message?: string };
        if (!response.ok) throw new Error(result.message ?? "Could not load the oversight summary.");
        if (active) setData(result);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "Could not load the oversight summary.");
      })
      .finally(() => { if (active) setLoading(false); });

    return () => { active = false; };
  }, [institutionId, program, reviewStatus]);

  const programOptions = data?.options.programs ?? [];

  return (
    <section className="space-y-5" aria-label={t("page.aicte.title")}>
      <div className="message message-notice">
        <strong>{t("aicte.notice.title")}</strong> {t("aicte.notice.body")}
      </div>

      {error && <p role="alert" className="message message-error">{localizeApiMessage(error, locale, t("aicte.apiError"))}</p>}

      <div className="grid gap-3 rounded-3xl border border-slate-200 bg-white p-4 shadow-sm md:grid-cols-3">
        <label>{t("aicte.filter.institution")}
          <select value={institutionId} onChange={(event) => { setInstitutionId(event.target.value); setProgram("ALL"); }} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-800">
            <option value="ALL">{t("aicte.filter.allInstitutions")}</option>
            {data?.options.institutions.map((institution) => <option key={institution.id} value={institution.id}>{institution.name} · {institution.code}</option>)}
          </select>
        </label>
        <label>{t("aicte.filter.program")}
          <select value={program} onChange={(event) => setProgram(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-800">
            <option value="ALL">{t("aicte.filter.allPrograms")}</option>
            {programOptions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </label>
        <label>{t("aicte.filter.reviewStatus")}
          <select value={reviewStatus} onChange={(event) => setReviewStatus(event.target.value as ReviewStatus)} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm font-normal text-slate-800">
            <option value="ALL">{t("aicte.filter.allStatuses")}</option>
            <option value="OPEN">{t("status.open")}</option>
            <option value="UNDER_REVIEW">{t("status.underReview")}</option>
            <option value="RESOLVED">{t("status.resolved")}</option>
          </select>
        </label>
        <p className="text-xs text-slate-500 md:col-span-3">{t("aicte.academicUnavailable")}</p>
      </div>

      <section className="metric-register" aria-label={t("aicte.metrics.label")}>
        <article aria-label={t("aicte.metricCount", { metric: t("aicte.metric.total") })} className="metric-register-item">
          <p>{t("aicte.metric.total")}</p>
          <strong>{loading ? "…" : data?.totals.totalRecords ?? 0}</strong>
        </article>
        {metricLabels.map((metric) => (
          <article key={metric} aria-label={t("aicte.metricCount", { metric: t(`aicte.metric.${metric}` as "aicte.metric.reported" | "aicte.metric.confirmed" | "aicte.metric.pending" | "aicte.metric.disputed" | "aicte.metric.unverified") })} className="metric-register-item" title={t(`aicte.definition.${metric}` as "aicte.definition.reported" | "aicte.definition.confirmed" | "aicte.definition.pending" | "aicte.definition.disputed" | "aicte.definition.unverified")}>
          <p>{t(`aicte.metric.${metric}` as "aicte.metric.reported" | "aicte.metric.confirmed" | "aicte.metric.pending" | "aicte.metric.disputed" | "aicte.metric.unverified")}</p>
            <strong>{loading ? "…" : data?.totals[metric] ?? 0}</strong>
            {metric === "disputed" && data && <small>{t("aicte.metric.recordDisputed", { count: data.totals.recordStatusDisputed })}<br />{t("aicte.metric.activeCases", { count: data.totals.activeDiscrepancyRecords })}</small>}
          </article>
        ))}
      </section>

      {data && <DataQualityFindings
        findings={data.qualityFindings}
        showIntakeUnavailable={!data.qualityRulePolicy.approvedIntakeAvailable}
      />}

      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-semibold text-slate-950">{t("aicte.table.title")}</h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">{t("aicte.table.description")}</p>
        </div>
        {loading ? <p className="p-6 text-sm text-slate-500">{t("aicte.loading")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[850px] border-collapse text-left text-sm">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                <tr><th className="px-5 py-3 font-semibold">{t("aicte.table.institution")}</th><th className="px-4 py-3 text-right font-semibold">{t("aicte.table.total")}</th>{metricLabels.map((metric) => <th key={metric} className="px-4 py-3 text-right font-semibold">{t(`aicte.metric.${metric}` as "aicte.metric.reported" | "aicte.metric.confirmed" | "aicte.metric.pending" | "aicte.metric.disputed" | "aicte.metric.unverified")}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data?.rows.map((row) => <tr key={row.institutionId}>
                  <th scope="row" className="px-5 py-4 font-semibold text-slate-800">{row.name}<span className="mt-0.5 block text-xs font-normal text-slate-500">{row.code}</span></th>
                  <td className="px-4 py-4 text-right tabular-nums text-slate-700">{row.totalRecords}</td>
                  {metricLabels.map((metric) => <td key={metric} className="px-4 py-4 text-right tabular-nums text-slate-700">
                    {row[metric]}
                    {metric === "disputed" && <span className="mt-1 block whitespace-nowrap text-[10px] leading-4 text-slate-500">{t("aicte.table.recordStatus", { count: row.recordStatusDisputed })} · {t("aicte.table.activeCases", { count: row.activeDiscrepancyRecords })}</span>}
                  </td>)}
                </tr>)}
                {data?.rows.length === 0 && <tr><td colSpan={7} className="px-5 py-10 text-center text-sm text-slate-500">{t("aicte.empty")}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p role="note" className="message message-neutral">{t("aicte.notice")}</p>
    </section>
  );
}
