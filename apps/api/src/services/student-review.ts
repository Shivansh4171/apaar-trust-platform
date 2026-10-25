import { z } from "zod";

export const studentRecordIdSchema = z.string().min(10).max(32);

export const discrepancyFieldSchema = z.enum(["REFERENCE", "FULL_NAME", "PROGRAM"]);

export type DiscrepancyFieldInput = z.infer<typeof discrepancyFieldSchema>;

export const studentDiscrepancyInputSchema = z.object({
  field: discrepancyFieldSchema,
  claimedValue: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(10).max(1000),
}).strict();

export const reviewerUpdateSchema = z.object({
  status: z.enum(["UNDER_REVIEW", "RESOLVED"]),
  resolutionNote: z.string().trim().min(5).max(1000),
}).strict();

export const emptyStudentConfirmationSchema = z.object({}).strict();

const claimedValueSchemas: Record<DiscrepancyFieldInput, z.ZodString> = {
  REFERENCE: z.string().trim().max(40).regex(
    /^SYNTH-[A-Za-z0-9][A-Za-z0-9_-]*$/i,
    "Synthetic references must start with SYNTH- and contain only letters, numbers, hyphens, or underscores.",
  ),
  FULL_NAME: z.string().trim().min(2).max(120).regex(
    /^[\p{L}][\p{L}\p{M} .'-]*$/u,
    "Name contains unsupported characters.",
  ),
  PROGRAM: z.string().trim().min(2).max(120).regex(
    /^[\p{L}\p{N}][\p{L}\p{M}\p{N} .&'+()/,-]*$/u,
    "Program contains unsupported characters.",
  ),
};

export function validateClaimedValue(field: DiscrepancyFieldInput, value: string) {
  return claimedValueSchemas[field].safeParse(value);
}

export function valueForField(
  record: { reference: string; fullName: string; program: string },
  field: DiscrepancyFieldInput,
): string {
  switch (field) {
    case "REFERENCE": return record.reference;
    case "FULL_NAME": return record.fullName;
    case "PROGRAM": return record.program;
  }
}
