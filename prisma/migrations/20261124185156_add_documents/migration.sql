-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PDF', 'DOCX', 'MSG', 'KMZ', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'REMOVED');

-- CreateEnum
CREATE TYPE "ExtractionStatus" AS ENUM ('OK', 'NO_TEXT', 'UNSUPPORTED', 'FAILED');

-- CreateEnum
CREATE TYPE "DocumentIngestStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
ALTER TYPE "McpScope" ADD VALUE 'DOCUMENTS_READ';

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'dropbox',
    "sourceFileId" TEXT NOT NULL,
    "parentId" TEXT,
    "path" TEXT NOT NULL,
    "folder" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "DocumentKind" NOT NULL,
    "sizeBytes" INTEGER,
    "contentHash" TEXT,
    "modifiedAt" TIMESTAMP(3),
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "extraction" "ExtractionStatus" NOT NULL,
    "extractionNote" TEXT,
    "pageCount" INTEGER NOT NULL DEFAULT 0,
    "meta" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPage" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "searchVector" tsvector GENERATED ALWAYS AS (to_tsvector('english', "text")) STORED,

    CONSTRAINT "DocumentPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentPlace" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "name" TEXT,
    "description" TEXT,
    "kmlFolder" TEXT,
    "geometryType" TEXT NOT NULL,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "coordinates" JSONB,

    CONSTRAINT "DocumentPlace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DocumentIngestRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "status" "DocumentIngestStatus" NOT NULL DEFAULT 'RUNNING',
    "force" BOOLEAN NOT NULL DEFAULT false,
    "counts" JSONB,
    "error" TEXT,

    CONSTRAINT "DocumentIngestRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_status_folder_idx" ON "Document"("status", "folder");

-- CreateIndex
CREATE INDEX "Document_parentId_idx" ON "Document"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_source_sourceFileId_key" ON "Document"("source", "sourceFileId");

-- CreateIndex
CREATE UNIQUE INDEX "DocumentPage_documentId_pageNumber_key" ON "DocumentPage"("documentId", "pageNumber");

-- CreateIndex
CREATE INDEX "DocumentPlace_documentId_idx" ON "DocumentPlace"("documentId");

-- CreateIndex
CREATE INDEX "DocumentIngestRun_status_startedAt_idx" ON "DocumentIngestRun"("status", "startedAt");

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPage" ADD CONSTRAINT "DocumentPage_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DocumentPlace" ADD CONSTRAINT "DocumentPlace_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Hand-written additions (not expressible in schema.prisma) --------------------------

-- Full-text search over page text. searchVector is a generated column (above).
CREATE INDEX "DocumentPage_searchVector_idx" ON "DocumentPage" USING GIN ("searchVector");

-- At most one ingest run at a time: a second concurrent run fails to insert its RUNNING row
-- and reports ALREADY_RUNNING (src/lib/server/documents/ingest.ts).
CREATE UNIQUE INDEX "DocumentIngestRun_one_running_idx" ON "DocumentIngestRun" ("status") WHERE "status" = 'RUNNING';
