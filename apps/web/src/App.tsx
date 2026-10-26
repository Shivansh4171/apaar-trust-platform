import { useEffect, useState, type FormEvent } from "react";
import StudentReviewPanel from "./components/StudentReviewPanel";
import InstitutionDiscrepancyPanel from "./components/InstitutionDiscrepancyPanel";
import AicteOversightDashboard from "./components/AicteOversightDashboard";
import RecordCorrectionHistory from "./components/RecordCorrectionHistory";
import StudentRecordCorrectionForm, { type CorrectableStudentRecord } from "./components/StudentRecordCorrectionForm";
import DataQualityFindings, { type DataQualityFinding } from "./components/DataQualityFindings";
import { localizeApiMessage, useLanguage } from "./i18n";

const pageSize = 10;

type StudentRecord = {
  id: string;
  reference: string;
  fullName: string;
  program: string;
  status: "VERIFIED" | "UNVERIFIED" | "PENDING" | "DISPUTED" | "REPORTED";
  synthetic: boolean;
  createdAt: string;
  institution: { name: string; code: string };
};

type ImportReport = {
  totalRows: number;
  findings: DataQualityFinding[];
  acceptedRows: Array<{ rowNumber: number; reference: string }>;
  rejectedRows: Array<{ rowNumber: number; reference: string | null; reasons: string[] }>;
  flaggedForReviewRows: Array<{
    rowNumber: number;
    reference: string;
    reasons: string[];
    possibleMatches: string[];
  }>;
};

type RecordListResponse = {
  institution: { code: string | null; name: string | null };
  records: StudentRecord[];
  pagination: { page: number; pageSize: number; totalRecords: number; totalPages: number };
};

type ApiError = { message?: string; report?: ImportReport };
type UserRole = "AICTE_ADMIN" | "INSTITUTION_ADMIN" | "INSTITUTION_OPERATOR" | "STUDENT" | "REVIEWER";
type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  institutionName: string | null;
  institutionCode: string | null;
  studentReference: string | null;
};

const statusStyles: Record<StudentRecord["status"], string> = {
  VERIFIED: "status-pill status-verified",
  UNVERIFIED: "status-pill status-unverified",
  PENDING: "status-pill status-pending",
  DISPUTED: "status-pill status-disputed",
  REPORTED: "status-pill status-reported",
};

function LanguageSwitcher() {
  const { locale, setLocale, t } = useLanguage();
  return <div className="language-switch" role="group" aria-label={t("lang.label")}>
    <button type="button" aria-pressed={locale === "en"} onClick={() => setLocale("en")}>{t("lang.english")}</button>
    <button type="button" aria-pressed={locale === "hi"} onClick={() => setLocale("hi")}>{t("lang.hindi")}</button>
  </div>;
}

function TextSizeControls() {
  const { t } = useLanguage();
  const [scale, setScale] = useState(0);
  function changeScale(next: number) {
    const value = Math.max(-1, Math.min(1, next));
    setScale(value);
    document.documentElement.dataset.portalTextSize = value < 0 ? "small" : value > 0 ? "large" : "normal";
  }
  return <div className="text-size-controls" role="group" aria-label={t("utility.textSize")}>
    <span>{t("utility.accessibility")}</span>
    <button type="button" aria-label={t("utility.textSmaller")} aria-pressed={scale === -1} onClick={() => changeScale(scale - 1)}>A−</button>
    <button type="button" aria-label={t("utility.textReset")} aria-pressed={scale === 0} onClick={() => changeScale(0)}>A</button>
    <button type="button" aria-label={t("utility.textLarger")} aria-pressed={scale === 1} onClick={() => changeScale(scale + 1)}>A+</button>
  </div>;
}

function PortalMasthead({ user, onSignOut }: { user?: AuthUser | null; onSignOut?: () => void }) {
  const { t } = useLanguage();
  return <>
    <a className="skip-link" href="#main-content">{t("a11y.skip")}</a>
    <div className="utility-bar"><div className="portal-container utility-inner"><span className="utility-note">{t("brand.demo")}</span><div className="utility-tools"><TextSizeControls /><LanguageSwitcher /></div></div></div>
    <header className="portal-masthead">
      <div className="portal-container masthead-inner">
        <a className="portal-brand" href="/" aria-label={t("brand.name")}><span className="portal-monogram" aria-hidden="true"><b>AP</b><i /></span><span className="brand-copy"><strong>{t("brand.name")}</strong><small>{t("brand.fullName")}</small></span></a>
        <div className="masthead-account">{user ? <><span className="user-context"><b>{t(`role.${user.role}`)}</b><span>{user.institutionName ?? t("session.platform")}</span></span><button type="button" onClick={onSignOut} className="button button-secondary">{t("session.signout")}</button></> : <span className="portal-classification">{t("brand.service")}</span>}</div>
      </div>
    </header>
  </>;
}

async function readApiError(response: Response): Promise<string> {
  try {
    const body = await response.json() as ApiError;
    return body.message ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

export default function App() {
  const { locale, t } = useLanguage();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<"institution" | "student" | "review" | "aicte">("institution");
  const [records, setRecords] = useState<StudentRecord[]>([]);
  const [totalRecords, setTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [recordsError, setRecordsError] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");
  const [importReport, setImportReport] = useState<ImportReport | null>(null);
  const [editingRecord, setEditingRecord] = useState<CorrectableStudentRecord | null>(null);
  const [historyRecord, setHistoryRecord] = useState<{ id: string; reference: string } | null>(null);

  useEffect(() => {
    fetch("/api/auth/me").then(async (response) => {
      if (response.ok) {
        const data = await response.json() as { user: AuthUser };
        setUser(data.user);
        setActiveWorkspace(data.user.role === "STUDENT" ? "student" : data.user.role === "REVIEWER" ? "review" : data.user.role === "AICTE_ADMIN" ? "aicte" : "institution");
      }
    }).catch(() => undefined).finally(() => setAuthLoading(false));
  }, []);

  async function loadRecords(targetPage: number) {
    setLoading(true);
    setRecordsError("");
    try {
      const response = await fetch(`/api/institution/records?page=${targetPage}&pageSize=${pageSize}`);
      if (!response.ok) throw new Error(await readApiError(response));
      const data = await response.json() as RecordListResponse;
      setRecords(data.records);
      setTotalRecords(data.pagination.totalRecords);
      setTotalPages(data.pagination.totalPages);
    } catch (error) {
      setRecordsError(error instanceof Error ? error.message : "Could not load student records.");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (user && ["AICTE_ADMIN", "INSTITUTION_ADMIN", "INSTITUTION_OPERATOR"].includes(user.role)) void loadRecords(page);
  }, [page, user]);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSigningIn(true);
    setAuthError("");
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const result = await response.json() as { user?: AuthUser; message?: string };
      if (!response.ok || !result.user) throw new Error(result.message ?? "Email or password is incorrect.");
      setUser(result.user);
      setActiveWorkspace(result.user.role === "STUDENT" ? "student" : result.user.role === "REVIEWER" ? "review" : result.user.role === "AICTE_ADMIN" ? "aicte" : "institution");
      setPassword("");
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : "Sign-in could not be completed.");
    } finally {
      setSigningIn(false);
    }
  }

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    setUser(null);
    setRecords([]);
    setEditingRecord(null);
    setHistoryRecord(null);
  }

  const canSeeRoster = user && ["AICTE_ADMIN", "INSTITUTION_ADMIN", "INSTITUTION_OPERATOR"].includes(user.role);
  const canImport = user && ["INSTITUTION_ADMIN", "INSTITUTION_OPERATOR"].includes(user.role);
  const canCorrectRecords = user?.role === "INSTITUTION_ADMIN";
  const canReview = user && ["AICTE_ADMIN", "REVIEWER", "INSTITUTION_ADMIN"].includes(user.role);

  if (authLoading) return <div className="portal-app"><PortalMasthead /><main id="main-content" className="portal-container loading-screen" aria-live="polite">{t("session.checking")}</main></div>;
  if (!user) return (
    <div className="portal-app"><PortalMasthead />
      <nav aria-label={t("nav.primary")} className="primary-nav"><div className="portal-container primary-nav-inner"><span className="primary-nav-current">{t("crumb.portal")}</span><span className="nav-demo-label">{t("page.prototype")}</span></div></nav>
      <main id="main-content" className="portal-container login-layout">
        <nav className="breadcrumbs" aria-label={t("nav.label")}><span>{t("crumb.portal")}</span><span aria-hidden="true">›</span><span>{t("login.title")}</span></nav>
        <div className="login-grid">
        <section className="login-panel">
          <div className="section-heading"><p className="eyebrow">{t("page.prototype")}</p><h1>{t("login.title")}</h1><p>{t("login.intro")}</p></div>
          {authError && <p role="alert" className="message message-error">{localizeApiMessage(authError, locale, t("login.failed"))}</p>}
          <form className="portal-form" onSubmit={handleLogin}>
            <label htmlFor="login-email">{t("login.email")}<input id="login-email" required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
            <label htmlFor="login-password">{t("login.password")}<input id="login-password" required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} /></label>
            <button disabled={signingIn} className="button button-primary button-wide">{signingIn ? t("login.submitting") : t("login.submit")}</button>
          </form>
          <p className="message message-notice">{t("login.notice")}</p>
        </section>
        <aside className="login-information"><h2>{t("brand.fullName")}</h2><p>{t("login.portalInfo")}</p><dl><div><dt>{t("login.availableFor")}</dt><dd>{t("login.roles")}</dd></div><div><dt>{t("login.dataNotice")}</dt><dd>{t("login.syntheticOnly")}</dd></div></dl></aside>
        </div>
      </main>
      <footer className="portal-footer"><div className="portal-container">{t("notice.confirmation.title")} {t("notice.confirmation.body")}</div></footer>
    </div>
  );

  async function handleImport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedFile) return;

    setImporting(true);
    setImportError("");
    setImportReport(null);
    const form = new FormData();
    form.append("file", selectedFile);

    try {
      const response = await fetch("/api/institution/records/import", {
        method: "POST",
        body: form,
      });
      const result = await response.json() as ApiError;
      if (result.report) setImportReport(result.report);
      if (!response.ok && !result.report) {
        setImportError(result.message ?? "The CSV could not be imported.");
      }
      if (response.ok) await loadRecords(page);
    } catch {
      setImportError("The API could not be reached. Your file was not confirmed as imported.");
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="portal-app">
      <PortalMasthead user={user} onSignOut={() => void handleLogout()} />
      <nav aria-label={t("nav.primary")} className="primary-nav"><div className="portal-container primary-nav-inner">
        {canSeeRoster && <button type="button" aria-current={activeWorkspace === "institution" ? "page" : undefined} onClick={() => setActiveWorkspace("institution")}>{t("nav.institution")}</button>}
        {user.role === "AICTE_ADMIN" && <button type="button" aria-current={activeWorkspace === "aicte" ? "page" : undefined} onClick={() => setActiveWorkspace("aicte")}>{t("nav.aicte")}</button>}
        {user.role === "STUDENT" && <button type="button" aria-current={activeWorkspace === "student" ? "page" : undefined} onClick={() => setActiveWorkspace("student")}>{t("nav.student")}</button>}
        {canReview && <button type="button" aria-current={activeWorkspace === "review" ? "page" : undefined} onClick={() => setActiveWorkspace("review")}>{t("nav.review")}</button>}
      </div></nav>
      <main id="main-content" className="portal-container">
        <nav className="breadcrumbs" aria-label={t("nav.label")}>
          <span>{t("crumb.portal")}</span><span aria-hidden="true">›</span>
          <span>{activeWorkspace === "student" ? t("crumb.student") : activeWorkspace === "review" ? t("crumb.review") : activeWorkspace === "aicte" ? t("crumb.oversight") : t("crumb.records")}</span>
        </nav>
        <section className="page-heading">
          <p className="eyebrow">{t("page.prototype")}</p>
          <div className="page-heading-row">
            <div>
              <h1>{activeWorkspace === "student" ? t("page.student.title") : activeWorkspace === "review" ? t("page.review.title") : activeWorkspace === "aicte" ? t("page.aicte.title") : t("page.institution.title")}</h1>
              <p>{activeWorkspace === "student" ? t("page.student.description") : activeWorkspace === "review" ? t("page.review.description") : activeWorkspace === "aicte" ? t("page.aicte.description") : t("page.institution.description")}</p>
            </div>
            {activeWorkspace === "institution" && <div className="record-total"><span>{user.role === "AICTE_ADMIN" ? t("institution.across") : t("institution.scoped")}</span><strong>{loading ? "…" : totalRecords}</strong></div>}
          </div>
          <div role="note" className="message message-notice"><strong>{t("notice.prototype.title")}</strong> {t("notice.prototype.body")}</div>
        </section>

        {activeWorkspace === "institution" && <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:items-start">
          <div className="roster-column">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
              <h2 className="text-base font-semibold text-slate-950">{t("institution.roster")}</h2>
                <p className="mt-1 text-xs text-slate-500">{user.role === "AICTE_ADMIN" ? t("institution.scopeNote") : t("institution.isolatedNote")}</p>
              </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{user.institutionCode ?? t("institution.allSynthetic")}</span>
            </div>

            {recordsError && (
              <div role="alert" className="message message-error">{localizeApiMessage(recordsError, locale, t("error.request"))}</div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold sm:px-6">{t("institution.table.reference")}</th>
                    <th className="px-4 py-3 font-semibold">{t("institution.table.name")}</th>
                    <th className="px-4 py-3 font-semibold">{t("institution.table.program")}</th>
                    <th className="px-4 py-3 font-semibold">{t("institution.table.institution")}</th>
                    <th className="px-5 py-3 font-semibold sm:px-6">{t("institution.table.status")}</th>
                    <th className="px-4 py-3 font-semibold">{t("institution.table.actions")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {records.map((record) => (
                    <tr key={record.id}>
                      <td className="whitespace-nowrap px-5 py-4 text-sm font-semibold text-slate-800 sm:px-6">{record.reference}</td>
                      <td className="whitespace-nowrap px-4 py-4 text-sm text-slate-700">{record.fullName}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{record.program}</td>
                      <td className="px-4 py-4 text-sm text-slate-600">{record.institution.name}</td>
                      <td className="whitespace-nowrap px-5 py-4 sm:px-6">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset ${statusStyles[record.status]}`}>
                          {t(`status.${record.status.toLowerCase()}` as "status.verified" | "status.unverified" | "status.pending" | "status.disputed" | "status.reported")}
                        </span>
                        {record.synthetic && <span className="ml-2 text-[10px] text-slate-400">{t("institution.synthetic")}</span>}
                      </td>
                      <td className="record-action-cell">
                        {canCorrectRecords && <button type="button" className="text-link-button" onClick={() => { setEditingRecord(record); setImportError(""); }}>{t("correction.edit")}</button>}
                        <button type="button" className="text-link-button" onClick={() => setHistoryRecord({ id: record.id, reference: record.reference })}>{t("correction.history.button")}</button>
                      </td>
                    </tr>
                  ))}
                  {!loading && records.length === 0 && !recordsError && (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-500">{t("institution.empty")}</td></tr>
                  )}
                  {loading && (
                    <tr><td colSpan={6} className="px-6 py-12 text-center text-sm text-slate-500">{t("institution.loading")}</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 sm:px-6">
              <p className="text-xs text-slate-500">{t("institution.page")} {page} {t("common.of")} {Math.max(totalPages, 1)}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">{t("common.previous")}</button>
                <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">{t("common.next")}</button>
              </div>
            </div>
          </div>
          {historyRecord && <section className="portal-panel correction-history-panel">
            <div className="correction-history-heading">
              <h2>{t("correction.history.title", { reference: historyRecord.reference })}</h2>
              <button type="button" className="button button-secondary" onClick={() => setHistoryRecord(null)}>{t("correction.history.close")}</button>
            </div>
            <RecordCorrectionHistory recordId={historyRecord.id} reference={historyRecord.reference} showTrigger={false} defaultExpanded />
          </section>}
          {canCorrectRecords && editingRecord && <StudentRecordCorrectionForm
            record={editingRecord}
            onCancel={() => setEditingRecord(null)}
            onCorrected={(corrected) => {
              setRecords((current) => current.map((record) => record.id === corrected.id ? { ...record, ...corrected } : record));
              setEditingRecord((current) => current?.id === corrected.id ? { ...current, ...corrected } : current);
            }}
          />}
          </div>

          <aside className="workflow-side">
          {canImport && <section className="portal-panel import-panel">
            <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-950">{t("institution.import.title")}</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">{t("institution.import.description")}</p>

            <form className="mt-5 space-y-3" onSubmit={handleImport}>
              <label htmlFor="csv-file" className="block cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center hover:border-indigo-400 hover:bg-indigo-50/40">
                <span className="block text-sm font-semibold text-slate-800">{t("institution.import.choose")}</span>
                <span className="mt-1 block truncate text-xs text-slate-500">{selectedFile?.name ?? t("institution.import.limit")}</span>
              </label>
              <input id="csv-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { setSelectedFile(event.target.files?.[0] ?? null); setImportReport(null); setImportError(""); }} />
              <button type="submit" disabled={!selectedFile || importing} className="w-full rounded-xl bg-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50">
                {importing ? t("institution.import.checking") : t("institution.import.upload")}
              </button>
            </form>

            {importError && <p role="alert" className="message message-error">{localizeApiMessage(importError, locale, t("institution.import.error"))}</p>}

            {importReport && (
              <section aria-label={t("institution.import.report")} className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="text-sm font-semibold text-slate-900">{t("institution.import.report")}</h3>
                <p className="mt-1 text-xs text-slate-500">{importReport.totalRows} {t("institution.import.rows")}</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-green-50 px-2 py-2"><span className="block text-lg font-semibold text-green-800">{importReport.acceptedRows.length}</span><span className="text-[10px] font-medium text-green-800">{t("institution.import.accepted")}</span></div>
                  <div className="rounded-xl bg-rose-50 px-2 py-2"><span className="block text-lg font-semibold text-rose-800">{importReport.rejectedRows.length}</span><span className="text-[10px] font-medium text-rose-800">{t("institution.import.rejected")}</span></div>
                  <div className="rounded-xl bg-amber-50 px-2 py-2"><span className="block text-lg font-semibold text-amber-800">{importReport.flaggedForReviewRows.length}</span><span className="text-[10px] font-medium text-amber-900">{t("institution.import.review")}</span></div>
                </div>
                <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1 text-xs">
                  {importReport.acceptedRows.map((row) => <li key={`a-${row.rowNumber}`} className="rounded-lg bg-green-50 px-3 py-2 text-green-900">{t("institution.import.acceptedRow", { row: row.rowNumber, reference: row.reference })}</li>)}
                  {importReport.rejectedRows.map((row) => <li key={`r-${row.rowNumber}`} className="rounded-lg bg-rose-50 px-3 py-2 text-rose-900"><strong>{t("institution.import.rejectedRow", { row: row.rowNumber, reference: row.reference ? ` · ${row.reference}` : "" })}</strong><ul className="mt-1 list-disc pl-4">{row.reasons.map((reason) => <li key={reason}>{localizeApiMessage(reason, locale, t("institution.import.rowCorrection"))}</li>)}</ul></li>)}
                  {importReport.flaggedForReviewRows.map((row) => <li key={`f-${row.rowNumber}`} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950"><strong>{t("institution.import.flaggedRow", { row: row.rowNumber, reference: row.reference })}</strong><ul className="mt-1 list-disc pl-4">{row.reasons.map((reason) => <li key={reason}>{localizeApiMessage(reason, locale, t("institution.import.rowCorrection"))}</li>)}</ul></li>)}
                </ul>
                <DataQualityFindings findings={importReport.findings} />
                <p className="mt-3 text-[11px] leading-5 text-slate-500">{t("institution.import.duplicateNote")}</p>
              </section>
            )}
          </section>}
          <section className="workflow-information" aria-labelledby="workflow-information-title">
            <h2 id="workflow-information-title">{t("institution.workflow.title")}</h2>
            <ul>
              {user.role === "INSTITUTION_ADMIN" && <>
                <li>{t("institution.workflow.admin.view")}</li>
                <li>{t("institution.workflow.admin.import")}</li>
                <li>{t("institution.workflow.admin.correction")}</li>
                <li>{t("institution.workflow.admin.disputes")}</li>
                <li>{t("institution.workflow.admin.demo")}</li>
              </>}
              {user.role === "INSTITUTION_OPERATOR" && <>
                <li>{t("institution.workflow.operator.view")}</li>
                <li>{t("institution.workflow.operator.import")}</li>
                <li>{t("institution.workflow.operator.disputes")}</li>
                <li>{t("institution.workflow.operator.demo")}</li>
              </>}
              {user.role === "AICTE_ADMIN" && <>
                <li>{t("institution.workflow.aicte.view")}</li>
                <li>{t("institution.workflow.aicte.readonly")}</li>
                <li>{t("institution.workflow.aicte.demo")}</li>
              </>}
            </ul>
          </section>
          </aside>
        </section>}

        {activeWorkspace === "student" && <StudentReviewPanel />}
        {activeWorkspace === "review" && canReview && <InstitutionDiscrepancyPanel canReview={user.role !== "INSTITUTION_OPERATOR"} crossInstitution={user.role === "AICTE_ADMIN" || user.role === "REVIEWER"} />}
        {activeWorkspace === "aicte" && user.role === "AICTE_ADMIN" && <AicteOversightDashboard />}

        <footer className="portal-footer"><strong>{t("notice.confirmation.title")}</strong> {t("notice.confirmation.body")}</footer>
      </main>
    </div>
  );
}
