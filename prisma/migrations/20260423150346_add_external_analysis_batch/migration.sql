-- CreateEnum
CREATE TYPE "ExternalAnalysisBatchStatus" AS ENUM ('QUEUED', 'CLAIMED', 'COMMITTED', 'ERROR');

-- CreateTable
CREATE TABLE "ExternalAnalysisBatch" (
    "id" TEXT NOT NULL,
    "sourceFolder" TEXT NOT NULL,
    "status" "ExternalAnalysisBatchStatus" NOT NULL DEFAULT 'QUEUED',
    "photoIds" TEXT[],
    "continuation" JSONB,
    "result" JSONB,
    "claimedAt" TIMESTAMP(3),
    "claimedBy" TEXT,
    "committedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalAnalysisBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalAnalysisBatch_status_idx" ON "ExternalAnalysisBatch"("status");
