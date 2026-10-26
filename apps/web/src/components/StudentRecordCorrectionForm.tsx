import { useState, type FormEvent } from "react";
import { localizeApiMessage, useLanguage } from "../i18n";

export type CorrectableStudentRecord = {
  id: string;
  reference: string;
  fullName: string;
  program: string;
  status: "VERIFIED" | "UNVERIFIED" | "PENDING" | "DISPUTED" | "REPORTED";
  updatedAt?: string;
};

type CorrectionResponse = { record: CorrectableStudentRecord; correction: { id: string } };

export default function StudentRecordCorrectionForm({
  record,
  onCancel,
  onCorrected,
}: {
  record: CorrectableStudentRecord;
  onCancel: () => void;
  onCorrected: (record: CorrectableStudentRecord) => void;
}) {
  const { locale, t } = useLanguage();
  const [reference, setReference] = useState(record.reference);
  const [fullName, setFullName] = useState(record.fullName);
  const [program, setProgram] = useState(record.program);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const response = await fetch(`/api/institution/records/${record.id}/corrections`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, fullName, program, reason }),
      });
      const result = await response.json() as CorrectionResponse & { message?: string };
      if (!response.ok || !result.record || !result.correction) throw new Error(result.message ?? t("correction.apiError"));
      onCorrected(result.record);
      setReference(result.record.reference);
      setFullName(result.record.fullName);
      setProgram(result.record.program);
      setReason("");
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : t("correction.apiError"));
    } finally {
      setSaving(false);
    }
  }

  return <section className="portal-panel correction-form-panel" aria-labelledby="correction-form-title">
    <div className="correction-form-heading">
      <div><h2 id="correction-form-title">{t("correction.title")}</h2><p className="panel-description">{t("correction.description")}</p></div>
      <span className="record-reference">{record.reference}</span>
    </div>
    {error && <p role="alert" className="message message-error">{localizeApiMessage(error, locale, t("correction.apiError"))}</p>}
    {saved && <p role="status" className="message message-success">{t("correction.saved")}</p>}
    <form className="portal-form" onSubmit={(event) => void submit(event)}>
      <label htmlFor="correction-reference">{t("correction.reference")}
        <input id="correction-reference" value={reference} onChange={(event) => setReference(event.target.value)} required minLength={2} maxLength={40} pattern="SYNTH-[A-Za-z0-9][A-Za-z0-9_-]*" />
      </label>
      <label htmlFor="correction-full-name">{t("correction.fullName")}
        <input id="correction-full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} required minLength={2} maxLength={120} />
      </label>
      <label htmlFor="correction-program">{t("correction.program")}
        <input id="correction-program" value={program} onChange={(event) => setProgram(event.target.value)} required minLength={2} maxLength={120} />
      </label>
      <label htmlFor="correction-reason">{t("correction.reason")}
        <textarea id="correction-reason" value={reason} onChange={(event) => setReason(event.target.value)} required minLength={10} maxLength={1000} rows={3} placeholder={t("correction.reason.placeholder")} />
      </label>
      <div className="correction-form-actions">
        <button type="button" className="button button-secondary" onClick={onCancel} disabled={saving}>{t("correction.cancel")}</button>
        <button type="submit" className="button button-primary" disabled={saving}>{saving ? t("correction.saving") : t("correction.save")}</button>
      </div>
    </form>
  </section>;
}
