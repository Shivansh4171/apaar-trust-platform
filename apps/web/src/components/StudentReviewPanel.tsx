import { useEffect, useState, type FormEvent } from "react";

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

const prototypeNote = "This signed-in account is a local synthetic demo account, not verified real-world identity. A missing response is not evidence of fraud.";

export default function StudentReviewPanel() {
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
      if (!response.ok) throw new Error(result.message ?? "The confirmation could not be recorded.");
      setMessage(result.message ?? "Demo confirmation recorded.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The confirmation could not be recorded.");
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
      if (!response.ok) throw new Error(result.message ?? "The discrepancy could not be recorded.");
      setReport(result.report ?? null);
      setMessage(result.message ?? "Discrepancy submitted.");
      setClaimedValue("");
      setReason("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "The discrepancy could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-6">
      <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 text-sm leading-6 text-amber-950 sm:p-6">
        <strong>Student review demo only.</strong> {prototypeNote} No information entered here is official APAAR verification.
      </div>

      {error && <p role="alert" className="rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
      {message && <p role="status" className="rounded-xl bg-green-50 px-4 py-3 text-sm text-green-900">{message}</p>}

      {loading ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading synthetic demo records…</div>
      ) : records.length === 0 ? (
        <div className="rounded-3xl border border-slate-200 bg-white p-8 text-sm text-slate-500">No synthetic records are available to review.</div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <label htmlFor="demo-record" className="block text-sm font-semibold text-slate-900">Select a synthetic demo record</label>
            <select id="demo-record" value={recordId} onChange={(event) => { setRecordId(event.target.value); setMessage(""); setReport(null); }} className="mt-2 w-full rounded-xl border border-slate-300 bg-white px-3 py-3 text-sm text-slate-800 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100">
              {records.map((record) => <option key={record.id} value={record.id}>{record.reference} · {record.fullName}</option>)}
            </select>
            {selectedRecord && (
              <dl className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-100">
                <div className="px-4 py-3"><dt className="text-xs font-medium text-slate-500">Institution-reported reference</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{selectedRecord.reference}</dd></div>
                <div className="px-4 py-3"><dt className="text-xs font-medium text-slate-500">Institution-reported name</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{selectedRecord.fullName}</dd></div>
                <div className="px-4 py-3"><dt className="text-xs font-medium text-slate-500">Institution-reported program</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{selectedRecord.program}</dd></div>
                <div className="px-4 py-3"><dt className="text-xs font-medium text-slate-500">Current record status</dt><dd className="mt-1 text-sm font-semibold text-slate-900">{selectedRecord.status.toLowerCase()} · not official APAAR verification</dd></div>
              </dl>
            )}
            <button type="button" onClick={() => void confirmRecord()} disabled={!selectedRecord || busy} className="mt-5 w-full rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? "Saving response…" : "These displayed details look correct"}
            </button>
          </section>

          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="text-base font-semibold text-slate-950">Report a discrepancy</h2>
            <p className="mt-1 text-sm leading-6 text-slate-600">Your claim and reason are recorded separately. The institution-reported value is preserved.</p>
            <form onSubmit={(event) => void submitDiscrepancy(event)} className="mt-5 space-y-4">
              <div>
                <label htmlFor="discrepancy-field" className="block text-xs font-semibold text-slate-700">Affected field</label>
                <select id="discrepancy-field" value={field} onChange={(event) => setField(event.target.value as DiscrepancyReport["field"])} className="mt-1.5 w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100">
                  <option value="REFERENCE">Student reference</option>
                  <option value="FULL_NAME">Student name</option>
                  <option value="PROGRAM">Program</option>
                </select>
              </div>
              <div>
                <label htmlFor="claimed-value" className="block text-xs font-semibold text-slate-700">Your claimed value</label>
                <input id="claimed-value" value={claimedValue} onChange={(event) => setClaimedValue(event.target.value)} maxLength={120} required className="mt-1.5 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100" />
              </div>
              <div>
                <label htmlFor="discrepancy-reason" className="block text-xs font-semibold text-slate-700">Reason for the discrepancy</label>
                <textarea id="discrepancy-reason" value={reason} onChange={(event) => setReason(event.target.value)} minLength={10} maxLength={1000} rows={4} required className="mt-1.5 w-full resize-y rounded-xl border border-slate-300 px-3 py-2.5 text-sm focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-100" placeholder="Explain what seems incorrect in this synthetic example." />
                <p className="mt-1 text-right text-[11px] text-slate-400">{reason.length}/1000</p>
              </div>
              <button type="submit" disabled={!selectedRecord || busy} className="w-full rounded-xl bg-indigo-700 px-4 py-3 text-sm font-semibold text-white hover:bg-indigo-800 disabled:cursor-not-allowed disabled:opacity-50">
                {busy ? "Submitting…" : "Submit discrepancy"}
              </button>
            </form>
            {report && (
              <div className="mt-5 rounded-2xl border border-indigo-100 bg-indigo-50/70 p-4 text-sm">
                <p className="font-semibold text-indigo-950">Report opened · {report.status.toLowerCase()}</p>
                <dl className="mt-3 space-y-2 text-xs text-slate-700">
                  <div><dt className="inline font-semibold">Institution value: </dt><dd className="inline">{report.institutionValue}</dd></div>
                  <div><dt className="inline font-semibold">Claimed value: </dt><dd className="inline">{report.claimedValue}</dd></div>
                  <div><dt className="inline font-semibold">Submitted: </dt><dd className="inline">{new Date(report.createdAt).toLocaleString()}</dd></div>
                </dl>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
