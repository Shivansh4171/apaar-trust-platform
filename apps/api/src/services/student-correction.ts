import { z } from "zod";
import { studentRecordValuesSchema } from "./csv-import.js";

export const studentRecordCorrectionInputSchema = z.object({
  reference: studentRecordValuesSchema.shape.reference.optional(),
  fullName: studentRecordValuesSchema.shape.fullName.optional(),
  program: studentRecordValuesSchema.shape.program.optional(),
  reason: z.string().trim().min(10, "Provide a correction reason of at least 10 characters.").max(1000, "Correction reasons must be at most 1000 characters."),
}).strict().refine(
  ({ reference, fullName, program }) => reference !== undefined || fullName !== undefined || program !== undefined,
  "Provide at least one changed record field.",
);

export type StudentRecordCorrectionInput = z.infer<typeof studentRecordCorrectionInputSchema>;

export type CorrectableStudentRecordValues = {
  reference: string;
  fullName: string;
  program: string;
};

export function correctionSnapshot(
  current: CorrectableStudentRecordValues,
  input: StudentRecordCorrectionInput,
) {
  const previousValues: Partial<CorrectableStudentRecordValues> = {};
  const newValues: Partial<CorrectableStudentRecordValues> = {};
  const update: Partial<CorrectableStudentRecordValues> = {};

  for (const field of ["reference", "fullName", "program"] as const) {
    const nextValue = input[field];
    if (nextValue === undefined || nextValue === current[field]) continue;
    previousValues[field] = current[field];
    newValues[field] = nextValue;
    update[field] = nextValue;
  }

  return { previousValues, newValues, update };
}
