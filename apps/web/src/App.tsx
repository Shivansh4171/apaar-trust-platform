import { useEffect, useState, type FormEvent } from "react";
import StudentReviewPanel from "./components/StudentReviewPanel";
import InstitutionDiscrepancyPanel from "./components/InstitutionDiscrepancyPanel";

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
  VERIFIED: "bg-green-50 text-green-700 ring-green-600/15",
  UNVERIFIED: "bg-slate-100 text-slate-700 ring-slate-600/10",
  PENDING: "bg-amber-50 text-amber-700 ring-amber-600/15",
  DISPUTED: "bg-rose-50 text-rose-700 ring-rose-600/15",
  REPORTED: "bg-violet-50 text-violet-700 ring-violet-600/15",
};

async function readApiError(response: Response): Promise<string> {
  try {
    const body = await response.json() as ApiError;
    return body.message ?? "The request could not be completed.";
  } catch {
    return "The request could not be completed.";
  }
}

export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [signingIn, setSigningIn] = useState(false);
  const [activeWorkspace, setActiveWorkspace] = useState<"institution" | "student" | "review">("institution");
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

  useEffect(() => {
    fetch("/api/auth/me").then(async (response) => {
      if (response.ok) {
        const data = await response.json() as { user: AuthUser };
        setUser(data.user);
        setActiveWorkspace(data.user.role === "STUDENT" ? "student" : data.user.role === "REVIEWER" ? "review" : "institution");
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
      setActiveWorkspace(result.user.role === "STUDENT" ? "student" : result.user.role === "REVIEWER" ? "review" : "institution");
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
  }

  const canSeeRoster = user && ["AICTE_ADMIN", "INSTITUTION_ADMIN", "INSTITUTION_OPERATOR"].includes(user.role);
  const canImport = user && ["INSTITUTION_ADMIN", "INSTITUTION_OPERATOR"].includes(user.role);
  const canReview = user && ["AICTE_ADMIN", "REVIEWER", "INSTITUTION_ADMIN"].includes(user.role);

  if (authLoading) return <main className="grid min-h-screen place-items-center text-sm text-slate-600">Checking your signed-in session…</main>;
  if (!user) return (
    <main className="grid min-h-screen place-items-center px-4 py-10">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-7 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-700">APAAR Trust · local prototype</p>
        <h1 className="mt-3 text-2xl font-semibold text-slate-950">Sign in to the demo</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Use a documented synthetic demo account. Sessions are stored server-side and this prototype does not connect to APAAR or government services.</p>
        {authError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{authError}</p>}
        <form className="mt-5 space-y-4" onSubmit={handleLogin}>
          <label className="block text-sm font-medium text-slate-700">Email<input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
          <label className="block text-sm font-medium text-slate-700">Password<input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5" /></label>
          <button disabled={signingIn} className="w-full rounded-xl bg-indigo-700 px-4 py-3 text-sm font-semibold text-white disabled:opacity-50">{signingIn ? "Signing in…" : "Sign in"}</button>
        </form>
        <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs leading-5 text-amber-950">Demo accounts and shared local-only password are documented in README.md. Do not enter real student data.</p>
      </section>
    </main>
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
    <main className="min-h-screen px-4 py-6 sm:px-7 lg:px-10">
      <div className="mx-auto max-w-7xl">
        <header className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-5">
          <a className="flex items-center gap-3" href="/" aria-label="APAAR Trust home">
            <span className="grid size-11 place-items-center rounded-2xl bg-indigo-700 text-sm font-bold text-white">AT</span>
            <span>
              <span className="block text-sm font-bold tracking-tight text-slate-950">APAAR Trust</span>
              <span className="block text-xs text-slate-500">Student and institution demo workspace</span>
            </span>
          </a>
          <div className="flex items-center gap-3">
            <span className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-semibold text-indigo-800">SIH 2026 · Prototype</span>
            <div className="flex items-center gap-3">
              <span className="rounded-full bg-white px-3 py-2 text-xs font-medium text-slate-600 ring-1 ring-slate-200">{user.role.replaceAll("_", " ")} · {user.institutionName ?? "Platform"}</span>
              <button type="button" onClick={() => void handleLogout()} className="rounded-xl border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">Sign out</button>
            </div>
          </div>
        </header>

        <section className="py-8 sm:py-10">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-indigo-700">Cross-verification prototype</p>
            <div className="mt-2 flex flex-wrap items-end justify-between gap-5">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 sm:text-4xl">
                {activeWorkspace === "student" ? "Review your demo record" : activeWorkspace === "review" ? "Review discrepancy reports" : "Student records"}
              </h1>
              <p className="mt-2 text-sm text-slate-600">
                {activeWorkspace === "student" ? "Check synthetic institution-reported details and respond." : activeWorkspace === "review" ? "Review student claims while keeping institution values intact." : "Review the institution’s current records or import a synthetic CSV roster."}
              </p>
            </div>
            {activeWorkspace === "institution" && <div className="min-w-36 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <p className="text-xs font-medium text-slate-500">{user.role === "AICTE_ADMIN" ? "Synthetic records across institutions" : "Records in this institution"}</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{loading ? "…" : totalRecords}</p>
            </div>}
          </div>

          <div role="note" className="mt-6 flex gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 text-sm leading-6 text-amber-950">
            <span className="mt-0.5 font-bold" aria-hidden="true">!</span>
            <p><strong>Local synthetic prototype.</strong> Sign-in enforces demo roles, but accounts and student data are fictional; this is not official APAAR verification and must not be used with real student data.</p>
          </div>
        </section>

        <nav aria-label="Prototype workspaces" className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-slate-200 bg-white p-2 shadow-sm">
          {canSeeRoster && <button type="button" aria-current={activeWorkspace === "institution" ? "page" : undefined} onClick={() => setActiveWorkspace("institution")} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${activeWorkspace === "institution" ? "bg-indigo-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Institution roster</button>}
          {user.role === "STUDENT" && <button type="button" aria-current={activeWorkspace === "student" ? "page" : undefined} onClick={() => setActiveWorkspace("student")} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${activeWorkspace === "student" ? "bg-indigo-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Student review</button>}
          {canReview && <button type="button" aria-current={activeWorkspace === "review" ? "page" : undefined} onClick={() => setActiveWorkspace("review")} className={`rounded-xl px-4 py-2.5 text-sm font-semibold ${activeWorkspace === "review" ? "bg-indigo-700 text-white" : "text-slate-600 hover:bg-slate-100"}`}>Discrepancy review</button>}
        </nav>

        {activeWorkspace === "institution" && <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)] lg:items-start">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4 sm:px-6">
              <div>
                <h2 className="text-base font-semibold text-slate-950">Institution roster</h2>
                <p className="mt-1 text-xs text-slate-500">{user.role === "AICTE_ADMIN" ? "Synthetic records are shown with their institution scope." : "Records are isolated to your authenticated institution."}</p>
              </div>
                <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">{user.institutionCode ?? "All synthetic institutions"}</span>
            </div>

            {recordsError && (
              <div role="alert" className="m-5 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{recordsError}</div>
            )}

            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] border-collapse text-left">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-5 py-3 font-semibold sm:px-6">Student reference</th>
                    <th className="px-4 py-3 font-semibold">Student name</th>
                    <th className="px-4 py-3 font-semibold">Program</th>
                    <th className="px-4 py-3 font-semibold">Institution</th>
                    <th className="px-5 py-3 font-semibold sm:px-6">Record state</th>
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
                          {record.status.toLowerCase()}
                        </span>
                        {record.synthetic && <span className="ml-2 text-[10px] text-slate-400">synthetic</span>}
                      </td>
                    </tr>
                  ))}
                  {!loading && records.length === 0 && !recordsError && (
                    <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">No student records are available for this page.</td></tr>
                  )}
                  {loading && (
                    <tr><td colSpan={5} className="px-6 py-12 text-center text-sm text-slate-500">Loading records…</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 sm:px-6">
              <p className="text-xs text-slate-500">Page {page} of {Math.max(totalPages, 1)}</p>
              <div className="flex gap-2">
                <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))} disabled={page <= 1 || loading} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Previous</button>
                <button type="button" onClick={() => setPage((current) => Math.min(totalPages, current + 1))} disabled={page >= totalPages || loading} className="rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-40">Next</button>
              </div>
            </div>
          </div>

          {canImport ? <aside className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="flex size-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-700" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" className="size-5" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M5 14v5h14v-5" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </div>
            <h2 className="mt-4 text-base font-semibold text-slate-950">Import a student CSV</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">Synthetic records only. References must start with <code className="text-xs text-slate-800">SYNTH-</code>. Required columns: <code className="text-xs text-slate-800">reference, fullName, program</code>.</p>

            <form className="mt-5 space-y-3" onSubmit={handleImport}>
              <label htmlFor="csv-file" className="block cursor-pointer rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-4 py-5 text-center hover:border-indigo-400 hover:bg-indigo-50/40">
                <span className="block text-sm font-semibold text-slate-800">Choose a CSV file</span>
                <span className="mt-1 block truncate text-xs text-slate-500">{selectedFile?.name ?? "CSV only · maximum 1 MB"}</span>
              </label>
              <input id="csv-file" type="file" accept=".csv,text/csv" className="sr-only" onChange={(event) => { setSelectedFile(event.target.files?.[0] ?? null); setImportReport(null); setImportError(""); }} />
              <button type="submit" disabled={!selectedFile || importing} className="w-full rounded-xl bg-indigo-700 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50">
                {importing ? "Checking and importing…" : "Upload and review"}
              </button>
            </form>

            {importError && <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2.5 text-sm text-rose-800">{importError}</p>}

            {importReport && (
              <section aria-label="CSV import report" className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="text-sm font-semibold text-slate-900">Import report</h3>
                <p className="mt-1 text-xs text-slate-500">{importReport.totalRows} data rows reviewed</p>
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-xl bg-green-50 px-2 py-2"><span className="block text-lg font-semibold text-green-800">{importReport.acceptedRows.length}</span><span className="text-[10px] font-medium text-green-800">Accepted</span></div>
                  <div className="rounded-xl bg-rose-50 px-2 py-2"><span className="block text-lg font-semibold text-rose-800">{importReport.rejectedRows.length}</span><span className="text-[10px] font-medium text-rose-800">Rejected</span></div>
                  <div className="rounded-xl bg-amber-50 px-2 py-2"><span className="block text-lg font-semibold text-amber-800">{importReport.flaggedForReviewRows.length}</span><span className="text-[10px] font-medium text-amber-900">Review</span></div>
                </div>
                <ul className="mt-3 max-h-72 space-y-2 overflow-y-auto pr-1 text-xs">
                  {importReport.acceptedRows.map((row) => <li key={`a-${row.rowNumber}`} className="rounded-lg bg-green-50 px-3 py-2 text-green-900">Row {row.rowNumber} · {row.reference} accepted</li>)}
                  {importReport.rejectedRows.map((row) => <li key={`r-${row.rowNumber}`} className="rounded-lg bg-rose-50 px-3 py-2 text-rose-900"><strong>Row {row.rowNumber}{row.reference ? ` · ${row.reference}` : ""} rejected</strong><ul className="mt-1 list-disc pl-4">{row.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></li>)}
                  {importReport.flaggedForReviewRows.map((row) => <li key={`f-${row.rowNumber}`} className="rounded-lg bg-amber-50 px-3 py-2 text-amber-950"><strong>Row {row.rowNumber} · {row.reference} needs review</strong><ul className="mt-1 list-disc pl-4">{row.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul></li>)}
                </ul>
                <p className="mt-3 text-[11px] leading-5 text-slate-500">Possible duplicates are held for review and are not merged or treated as fraud.</p>
              </section>
            )}
          </aside> : <aside className="rounded-3xl border border-slate-200 bg-white p-5 text-sm leading-6 text-slate-600 shadow-sm sm:p-6">This role can review the synthetic institution roster but cannot import records.</aside>}
        </section>}

        {activeWorkspace === "student" && <StudentReviewPanel />}
        {activeWorkspace === "review" && canReview && <InstitutionDiscrepancyPanel canReview={user.role !== "INSTITUTION_OPERATOR"} />}

        <footer className="mt-8 border-t border-slate-200 py-5 text-xs text-slate-500">
          Student confirmation is not official APAAR verification. No government integrations are connected.
        </footer>
      </div>
    </main>
  );
}
