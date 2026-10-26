import { useEffect, useState } from "react";
import { localizeApiMessage, useLanguage } from "../i18n";

type ActorRole = "AICTE_ADMIN" | "INSTITUTION_ADMIN" | "INSTITUTION_OPERATOR" | "STUDENT" | "REVIEWER";
type CorrectionField = "reference" | "fullName" | "program";
type CorrectionEvent = {
  id: string;
  previousValues: Partial<Record<CorrectionField, string>>;
  newValues: Partial<Record<CorrectionField, string>>;
  reason: string;
  actorEmail: string;
  actorRole: ActorRole;
  createdAt: string;
};

const fields: Array<{ field: CorrectionField; label: "correction.reference" | "correction.fullName" | "correction.program" }> = [
  { field: "reference", label: "correction.reference" },
  { field: "fullName", label: "correction.fullName" },
  { field: "program", label: "correction.program" },
];

const actorRoleLabels: Record<ActorRole, "role.AICTE_ADMIN" | "role.INSTITUTION_ADMIN" | "role.INSTITUTION_OPERATOR" | "role.STUDENT" | "role.REVIEWER"> = {
  AICTE_ADMIN: "role.AICTE_ADMIN",
  INSTITUTION_ADMIN: "role.INSTITUTION_ADMIN",
  INSTITUTION_OPERATOR: "role.INSTITUTION_OPERATOR",
  STUDENT: "role.STUDENT",
  REVIEWER: "role.REVIEWER",
};

export default function RecordCorrectionHistory({
  recordId,
  reference,
  showTrigger = true,
  defaultExpanded = false,
}: {
  recordId: string;
  reference: string;
  showTrigger?: boolean;
  defaultExpanded?: boolean;
}) {
  const { locale, t, formatDate } = useLanguage();
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [events, setEvents] = useState<CorrectionEvent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!expanded || events !== null) return;
    let active = true;
    setLoading(true);
    fetch(`/api/institution/records/${recordId}/corrections`)
      .then(async (response) => {
        const result = await response.json() as { corrections?: CorrectionEvent[]; message?: string };
        if (!response.ok) throw new Error(result.message ?? t("correction.history.loadError"));
        if (active) setEvents(result.corrections ?? []);
      })
      .catch((loadError: unknown) => {
        if (active) setError(loadError instanceof Error ? loadError.message : t("correction.history.loadError"));
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [expanded, events, recordId, t]);

  return <div className="record-history">
    {showTrigger && <button type="button" className="text-link-button" aria-expanded={expanded} onClick={() => setExpanded((current) => !current)}>
      {t("correction.history.button")}
    </button>}
    {expanded && <section className="record-history-content" aria-label={t("correction.history.title", { reference })}>
      {loading && <p aria-live="polite">{t("correction.history.loading")}</p>}
      {error && <p role="alert" className="message message-error">{localizeApiMessage(error, locale, t("correction.history.loadError"))}</p>}
      {events?.length === 0 && <p>{t("correction.history.empty")}</p>}
      {events && events.length > 0 && <ol>
        {events.map((event) => <li key={event.id}>
          <p className="record-history-actor"><strong>{event.actorEmail}</strong> · {t(actorRoleLabels[event.actorRole])}</p>
          <p className="record-history-date">{formatDate(event.createdAt)}</p>
          <p><strong>{t("correction.history.reason")}</strong> {event.reason}</p>
          <div className="record-history-changes"><strong>{t("correction.history.changes")}</strong>
            <ul>{fields.filter(({ field }) => field in event.previousValues && field in event.newValues).map(({ field, label }) => <li key={field}>
              <span>{t(label)}:</span> <del>{event.previousValues[field]}</del> <span aria-hidden="true">→</span> <ins>{event.newValues[field]}</ins>
            </li>)}</ul>
          </div>
        </li>)}
      </ol>}
    </section>}
  </div>;
}
