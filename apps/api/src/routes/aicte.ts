import { Router } from "express";
import { z } from "zod";
import { DiscrepancyStatus, PrismaClient, RecordStatus } from "../generated/prisma/client.js";
import { requireAuthentication, requireRoles } from "../auth.js";
import { evaluateStoredRecordQuality, qualityRulePolicy } from "../services/data-quality.js";

const oversightQuerySchema = z.object({
  institutionId: z.string().trim().min(10).max(32).optional(),
  program: z.string().trim().min(1).max(120).optional(),
  reviewStatus: z.enum(["ALL", "OPEN", "UNDER_REVIEW", "RESOLVED"]).default("ALL"),
}).strict();

type InstitutionCounts = {
  institutionId: string;
  code: string;
  name: string;
  totalRecords: number;
  reported: number;
  confirmed: number;
  pending: number;
  disputed: number;
  recordStatusDisputed: number;
  activeDiscrepancyRecords: number;
  unverified: number;
};

export function createAicteRouter(prisma: PrismaClient): Router {
  const router = Router();
  router.use(requireAuthentication(prisma), requireRoles("AICTE_ADMIN"));

  router.get("/oversight", async (request, response) => {
    const parsed = oversightQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      response.status(400).json({ error: "invalid_filters", message: "Choose a valid institution, program, and review status." });
      return;
    }

    const { institutionId, program, reviewStatus } = parsed.data;
    try {
      const institutions = await prisma.institution.findMany({
        where: { students: { some: { synthetic: true } } },
        orderBy: [{ name: "asc" }, { code: "asc" }],
        select: { id: true, code: true, name: true },
      });
      if (institutionId && !institutions.some((institution) => institution.id === institutionId)) {
        response.status(404).json({ error: "institution_not_found", message: "No synthetic institution matches this filter." });
        return;
      }

      const recordWhere = {
        synthetic: true,
        ...(institutionId ? { institutionId } : {}),
        ...(program ? { program } : {}),
        ...(reviewStatus !== "ALL" ? { discrepancies: { some: { synthetic: true, status: reviewStatus } } } : {}),
      };
      const programWhere = { synthetic: true, ...(institutionId ? { institutionId } : {}) };
      // Quality findings describe record values, not discrepancy-case workflow status.
      const qualityRecordWhere = { synthetic: true, ...(institutionId ? { institutionId } : {}), ...(program ? { program } : {}) };

      const [statusGroups, confirmedRecords, disputedRecords, recordStatusDisputedRecords, activeDiscrepancyRecords, programs, qualityRecords] = await Promise.all([
        prisma.studentRecord.groupBy({
          by: ["institutionId", "status"],
          where: recordWhere,
          _count: { _all: true },
        }),
        prisma.studentRecord.findMany({
          where: { ...recordWhere, confirmations: { some: { synthetic: true } } },
          select: { institutionId: true },
        }),
        prisma.studentRecord.findMany({
          where: {
            ...recordWhere,
            OR: [
              { status: RecordStatus.DISPUTED },
              { discrepancies: { some: { synthetic: true, status: { in: [DiscrepancyStatus.OPEN, DiscrepancyStatus.UNDER_REVIEW] } } } },
            ],
          },
          select: { institutionId: true },
        }),
        prisma.studentRecord.findMany({
          where: { ...recordWhere, status: RecordStatus.DISPUTED },
          select: { institutionId: true },
        }),
        prisma.studentRecord.findMany({
          where: {
            ...recordWhere,
            discrepancies: { some: { synthetic: true, status: { in: [DiscrepancyStatus.OPEN, DiscrepancyStatus.UNDER_REVIEW] } } },
          },
          select: { institutionId: true },
        }),
        prisma.studentRecord.findMany({
          where: programWhere,
          distinct: ["program"],
          orderBy: { program: "asc" },
          select: { program: true },
        }),
        prisma.studentRecord.findMany({
          where: qualityRecordWhere,
          orderBy: [{ institutionId: "asc" }, { reference: "asc" }, { id: "asc" }],
          select: { id: true, institutionId: true, reference: true, fullName: true, program: true },
        }),
      ]);
      const qualityFindings = evaluateStoredRecordQuality(qualityRecords.map(({ id, ...record }) => ({ ...record, recordId: id })));

      const byInstitution = new Map<string, InstitutionCounts>();
      for (const institution of institutions) {
        if (!institutionId || institution.id === institutionId) {
          byInstitution.set(institution.id, {
            institutionId: institution.id,
            code: institution.code,
            name: institution.name,
            totalRecords: 0,
            reported: 0,
            confirmed: 0,
            pending: 0,
            disputed: 0,
            recordStatusDisputed: 0,
            activeDiscrepancyRecords: 0,
            unverified: 0,
          });
        }
      }

      for (const group of statusGroups) {
        const counts = byInstitution.get(group.institutionId);
        if (!counts) continue;
        counts.totalRecords += group._count._all;
        if (group.status === RecordStatus.REPORTED) counts.reported += group._count._all;
        if (group.status === RecordStatus.PENDING) counts.pending += group._count._all;
        if (group.status === RecordStatus.UNVERIFIED) counts.unverified += group._count._all;
      }
      for (const record of confirmedRecords) {
        const counts = byInstitution.get(record.institutionId);
        if (counts) counts.confirmed += 1;
      }
      for (const record of disputedRecords) {
        const counts = byInstitution.get(record.institutionId);
        if (counts) counts.disputed += 1;
      }
      for (const record of recordStatusDisputedRecords) {
        const counts = byInstitution.get(record.institutionId);
        if (counts) counts.recordStatusDisputed += 1;
      }
      for (const record of activeDiscrepancyRecords) {
        const counts = byInstitution.get(record.institutionId);
        if (counts) counts.activeDiscrepancyRecords += 1;
      }

      const rows = [...byInstitution.values()];
      const totals = rows.reduce((sum, row) => ({
        totalRecords: sum.totalRecords + row.totalRecords,
        reported: sum.reported + row.reported,
        confirmed: sum.confirmed + row.confirmed,
        pending: sum.pending + row.pending,
        disputed: sum.disputed + row.disputed,
        recordStatusDisputed: sum.recordStatusDisputed + row.recordStatusDisputed,
        activeDiscrepancyRecords: sum.activeDiscrepancyRecords + row.activeDiscrepancyRecords,
        unverified: sum.unverified + row.unverified,
      }), { totalRecords: 0, reported: 0, confirmed: 0, pending: 0, disputed: 0, recordStatusDisputed: 0, activeDiscrepancyRecords: 0, unverified: 0 });

      response.json({
        rows,
        totals,
        qualityFindings,
        qualityRulePolicy,
        filters: { institutionId: institutionId ?? "ALL", program: program ?? "ALL", reviewStatus },
        options: {
          institutions,
          programs: programs.map((entry) => entry.program),
          reviewStatuses: ["ALL", ...Object.values(DiscrepancyStatus)],
          academicYearAvailable: false,
        },
        metricDefinitions: {
          reported: "Records whose institution-provided workflow status is REPORTED.",
          confirmed: "Records with at least one synthetic student confirmation event; this is not official verification.",
          pending: "Records whose institution-provided workflow status is PENDING.",
          disputed: "Distinct records marked DISPUTED or with an OPEN or UNDER_REVIEW discrepancy. Resolving a case does not change the record status.",
          recordStatusDisputed: "Records whose institution-provided RecordStatus is DISPUTED.",
          activeDiscrepancyRecords: "Records with at least one OPEN or UNDER_REVIEW discrepancy report.",
          unverified: "Records whose institution-provided workflow status is UNVERIFIED.",
        },
        notice: "Disputed is the distinct-record union of record status DISPUTED and active discrepancy cases; the two displayed source counts may overlap. Resolving a discrepancy changes only the case and its audit history, not the institution-reported student record. Missing student responses are not fraud evidence. Student confirmation is not official APAAR verification.",
      });
    } catch {
      response.status(503).json({ error: "oversight_unavailable", message: "The synthetic oversight summary is temporarily unavailable." });
    }
  });

  return router;
}
