-- Direction A phase 2: issues and issue rules (additive only; no existing table changes).
-- prisma migrate dev also proposed dropping DocumentPage_searchVector_idx and altering the
-- generated searchVector column: that is Prisma misreading the generated column, removed by hand.

-- CreateEnum
CREATE TYPE "LeacoIssueKind" AS ENUM ('SHUTDOWN', 'IDLE', 'OFFLINE', 'TICKET', 'STUCK', 'WATER_DROP', 'REPORT_LATE');

-- CreateEnum
CREATE TYPE "LeacoIssueStatus" AS ENUM ('OPEN', 'CONTRACTOR_SENT', 'ARCHIVED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "LeacoArchiveReason" AS ENUM ('NORMAL_FOR_WELL', 'NOT_URGENT', 'SCHEDULED', 'DATA_PROBLEM');

-- CreateTable
CREATE TABLE "LeacoIssue" (
    "id" TEXT NOT NULL,
    "assetKey" TEXT NOT NULL,
    "kind" "LeacoIssueKind" NOT NULL,
    "status" "LeacoIssueStatus" NOT NULL DEFAULT 'OPEN',
    "assetName" TEXT NOT NULL,
    "property" TEXT,
    "detail" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "archiveReason" "LeacoArchiveReason",
    "returnOn" DATE,
    "note" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeacoIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeacoIssueRule" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "threshold" INTEGER,
    "option" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeacoIssueRule_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "LeacoIssue_status_idx" ON "LeacoIssue"("status");

-- CreateIndex
CREATE INDEX "LeacoIssue_assetKey_kind_idx" ON "LeacoIssue"("assetKey", "kind");
