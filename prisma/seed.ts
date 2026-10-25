import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, RecordStatus } from "../apps/api/src/generated/prisma/client.js";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
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

  console.info(`Seeded ${sampleRecords.length} synthetic student records.`);
}

main()
  .catch((error: unknown) => {
    console.error("Synthetic database seed failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
