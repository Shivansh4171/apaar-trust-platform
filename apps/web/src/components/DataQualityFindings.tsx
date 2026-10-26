import { useLanguage, type MessageKey } from "../i18n";

export type DataQualityRuleId =
  | "REQUIRED_FIELD_MISSING"
  | "REQUIRED_FIELD_MALFORMED"
  | "CSV_ROW_STRUCTURE_INVALID"
  | "DUPLICATE_INSTITUTION_REFERENCE"
  | "CONFLICTING_DETAILS_FOR_REFERENCE"
  | "APPROVED_INTAKE_EXCEEDED";

export type DataQualityFinding = {
  id: string;
  ruleId: DataQualityRuleId;
  category: "DATA_QUALITY_ERROR" | "POSSIBLE_DUPLICATE" | "POSSIBLE_INCONSISTENCY";
  severity: "ERROR" | "HIGH" | "MEDIUM";
  decisionState: "ADVISORY";
  affected: { recordId?: string; rowNumber?: number; reference?: string; institutionId?: string; program?: string };
  matched?: { recordId?: string; rowNumber?: number; reference: string };
  triggerValues: Record<string, string | number | null>;
};

const ruleText: Record<DataQualityRuleId, { title: MessageKey; explanation: MessageKey; next: MessageKey }> = {
  REQUIRED_FIELD_MISSING: {
    title: "quality.rule.REQUIRED_FIELD_MISSING.title",
    explanation: "quality.rule.REQUIRED_FIELD_MISSING.explanation",
    next: "quality.rule.REQUIRED_FIELD_MISSING.next",
  },
  REQUIRED_FIELD_MALFORMED: {
    title: "quality.rule.REQUIRED_FIELD_MALFORMED.title",
    explanation: "quality.rule.REQUIRED_FIELD_MALFORMED.explanation",
    next: "quality.rule.REQUIRED_FIELD_MALFORMED.next",
  },
  CSV_ROW_STRUCTURE_INVALID: {
    title: "quality.rule.CSV_ROW_STRUCTURE_INVALID.title",
    explanation: "quality.rule.CSV_ROW_STRUCTURE_INVALID.explanation",
    next: "quality.rule.CSV_ROW_STRUCTURE_INVALID.next",
  },
  DUPLICATE_INSTITUTION_REFERENCE: {
    title: "quality.rule.DUPLICATE_INSTITUTION_REFERENCE.title",
    explanation: "quality.rule.DUPLICATE_INSTITUTION_REFERENCE.explanation",
    next: "quality.rule.DUPLICATE_INSTITUTION_REFERENCE.next",
  },
  CONFLICTING_DETAILS_FOR_REFERENCE: {
    title: "quality.rule.CONFLICTING_DETAILS_FOR_REFERENCE.title",
    explanation: "quality.rule.CONFLICTING_DETAILS_FOR_REFERENCE.explanation",
    next: "quality.rule.CONFLICTING_DETAILS_FOR_REFERENCE.next",
  },
  APPROVED_INTAKE_EXCEEDED: {
    title: "quality.rule.APPROVED_INTAKE_EXCEEDED.title",
    explanation: "quality.rule.APPROVED_INTAKE_EXCEEDED.explanation",
    next: "quality.rule.APPROVED_INTAKE_EXCEEDED.next",
  },
};

const valueLabels: Record<string, MessageKey> = {
  field: "quality.value.field",
  submittedValue: "quality.value.submittedValue",
  reference: "quality.value.reference",
  matchedReference: "quality.value.matchedReference",
  fullName: "quality.value.fullName",
  matchedFullName: "quality.value.matchedFullName",
  program: "quality.value.program",
  matchedProgram: "quality.value.matchedProgram",
  conflictingFields: "quality.value.conflictingFields",
  expectedFields: "quality.value.expectedFields",
  foundFields: "quality.value.foundFields",
  reportedEnrollment: "quality.value.reportedEnrollment",
  approvedIntake: "quality.value.approvedIntake",
  sourceReference: "quality.value.sourceReference",
};

function localizeTriggerValue(key: string, value: string | number | null, t: (key: MessageKey, values?: Record<string, string | number>) => string) {
  if (value === null) return t("quality.missingValue");
  if (key === "field") {
    const fieldKey = value === "reference" ? "quality.value.reference"
      : value === "fullName" ? "quality.value.fullName"
        : value === "program" ? "quality.value.program" : null;
    return fieldKey ? t(fieldKey) : String(value);
  }
  if (key === "conflictingFields") {
    return String(value).split(", ").map((field) => field === "fullName" ? t("quality.value.fullName") : field === "program" ? t("quality.value.program") : field).join(", ");
  }
  return String(value);
}

export default function DataQualityFindings({
  findings,
  showIntakeUnavailable = false,
}: {
  findings: DataQualityFinding[];
  showIntakeUnavailable?: boolean;
}) {
  const { t } = useLanguage();
  return (
    <section className="portal-panel data-quality-panel" aria-labelledby="data-quality-title">
      <h2 id="data-quality-title">{t("quality.panel.title")}</h2>
      <p>{t("quality.advisory")}</p>
      {showIntakeUnavailable && <p className="message message-neutral">{t("quality.intakeUnavailable")}</p>}
      <details className="data-quality-priority">
        <summary>{t("quality.priority.criteria")}</summary>
        <ul>
          <li><strong>{t("quality.severity.ERROR")}:</strong> {t("quality.priority.criteria.ERROR")}</li>
          <li><strong>{t("quality.severity.HIGH")}:</strong> {t("quality.priority.criteria.HIGH")}</li>
          <li><strong>{t("quality.severity.MEDIUM")}:</strong> {t("quality.priority.criteria.MEDIUM")}</li>
        </ul>
      </details>
      {findings.length === 0 ? <p className="data-quality-empty">{t("quality.panel.empty")}</p> : (
        <ol className="data-quality-list">
          {findings.map((finding) => {
            const text = ruleText[finding.ruleId];
            return (
              <li key={finding.id} className={`data-quality-item data-quality-${finding.severity.toLowerCase()}`}>
                <div className="data-quality-item-heading">
                  <h3>{t(text.title)}</h3>
                  <span className="data-quality-label">{t(`quality.severity.${finding.severity}`)}</span>
                </div>
                <p className="data-quality-category">{t(`quality.category.${finding.category}`)}</p>
                <p>{finding.affected.rowNumber !== undefined
                  ? t("quality.affectedRow", { row: finding.affected.rowNumber })
                  : t("quality.affectedRecord", { reference: finding.affected.reference ?? finding.affected.recordId ?? "" })}</p>
                <p>{t(text.explanation, {
                  field: localizeTriggerValue("field", finding.triggerValues.field ?? "", t),
                  reference: String(finding.triggerValues.reference ?? finding.affected.reference ?? ""),
                  matchedReference: String(finding.triggerValues.matchedReference ?? finding.matched?.reference ?? ""),
                  foundFields: finding.triggerValues.foundFields ?? 0,
                  expectedFields: finding.triggerValues.expectedFields ?? 0,
                  reportedEnrollment: finding.triggerValues.reportedEnrollment ?? 0,
                  approvedIntake: finding.triggerValues.approvedIntake ?? 0,
                })}</p>
                {finding.matched && <p className="data-quality-match">{t("quality.matched", { reference: finding.matched.reference })}</p>}
                <dl className="data-quality-values">
                  <dt>{t("quality.values")}</dt>
                  {Object.entries(finding.triggerValues).map(([key, value]) => (
                    <div key={key}>
                      <dt>{valueLabels[key] ? t(valueLabels[key]) : key}</dt>
                      <dd>{localizeTriggerValue(key, value, t)}</dd>
                    </div>
                  ))}
                </dl>
                <p className="data-quality-next"><strong>{t("quality.next")}:</strong> {t(text.next)}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
