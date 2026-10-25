import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { PrismaClient, RecordStatus, UserRole } from "../apps/api/src/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  if (process.env.NODE_ENV === "production") {
    throw new Error("The synthetic demo seed is disabled in production.");
  }

  const institution = await prisma.institution.upsert({
    where: { code: "DEMO-AICTE-001" },
    update: { name: "Synthetic Demo Institute of Technology" },
    create: {
      code: "DEMO-AICTE-001",
      name: "Synthetic Demo Institute of Technology",
    },
  });

  const sampleRecords = [
    {
      reference: "SYNTH-2026-001",
      fullName: "Aarav Sample",
      program: "Computer Engineering",
      status: RecordStatus.UNVERIFIED,
    },
    {
      reference: "SYNTH-2026-002",
      fullName: "Diya Example",
      program: "Electrical Engineering",
      status: RecordStatus.PENDING,
    },
    {
      reference: "SYNTH-2026-003",
      fullName: "Kabir Demo",
      program: "Mechanical Engineering",
      status: RecordStatus.DISPUTED,
    },
  ];

  for (const record of sampleRecords) {
    await prisma.studentRecord.upsert({
      where: {
        institutionId_reference: {
          institutionId: institution.id,
          reference: record.reference,
        },
      },
      update: { ...record, synthetic: true },
      create: { ...record, institutionId: institution.id, synthetic: true },
    });
  }

  const secondInstitution = await prisma.institution.upsert({
    where: { code: "DEMO-AICTE-002" },
    update: { name: "Synthetic Demo College of Applied Sciences" },
    create: { code: "DEMO-AICTE-002", name: "Synthetic Demo College of Applied Sciences" },
  });
  const secondRecord = await prisma.studentRecord.upsert({
    where: { institutionId_reference: { institutionId: secondInstitution.id, reference: "SYNTH-2026-201" } },
    update: { fullName: "Nila Sample", program: "Applied Mathematics", status: RecordStatus.UNVERIFIED, synthetic: true },
    create: {
      institutionId: secondInstitution.id,
      reference: "SYNTH-2026-201",
      fullName: "Nila Sample",
      program: "Applied Mathematics",
      status: RecordStatus.UNVERIFIED,
      synthetic: true,
    },
  });

  const primaryRecords = await prisma.studentRecord.findMany({
    where: { institutionId: institution.id, reference: { in: ["SYNTH-2026-001", "SYNTH-2026-002"] } },
    select: { id: true, reference: true },
  });
  const aarav = primaryRecords.find((record) => record.reference === "SYNTH-2026-001");
  const diya = primaryRecords.find((record) => record.reference === "SYNTH-2026-002");
  if (!aarav || !diya) throw new Error("Expected synthetic student records are missing.");

  const passwordHash = await argon2.hash("DemoOnly-2026!", { type: argon2.argon2id });
  const demoAccounts = [
    { email: "aicte.admin@demo.local", role: UserRole.AICTE_ADMIN, institutionId: null, studentRecordId: null },
    { email: "reviewer@demo.local", role: UserRole.REVIEWER, institutionId: null, studentRecordId: null },
    { email: "institution.admin@demo.local", role: UserRole.INSTITUTION_ADMIN, institutionId: institution.id, studentRecordId: null },
    { email: "institution.operator@demo.local", role: UserRole.INSTITUTION_OPERATOR, institutionId: institution.id, studentRecordId: null },
    { email: "student.aarav@demo.local", role: UserRole.STUDENT, institutionId: institution.id, studentRecordId: aarav.id },
    { email: "institution2.admin@demo.local", role: UserRole.INSTITUTION_ADMIN, institutionId: secondInstitution.id, studentRecordId: null },
    { email: "student.nila@demo.local", role: UserRole.STUDENT, institutionId: secondInstitution.id, studentRecordId: secondRecord.id },
  ];

  for (const account of demoAccounts) {
    await prisma.user.upsert({
      where: { email: account.email },
      update: { ...account, passwordHash, active: true },
      create: { ...account, passwordHash, active: true },
    });
  }

  console.info(`Seeded ${sampleRecords.length + 1} synthetic student records and ${demoAccounts.length} local demo accounts.`);
}

main()
  .catch((error: unknown) => {
    console.error("Synthetic database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
