-- CreateEnum
CREATE TYPE "ItemStatus" AS ENUM ('DRAFT', 'READY', 'LISTED', 'SOLD', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ItemStage" AS ENUM ('INGESTED', 'GROUPED', 'IDENTIFIED', 'MATCHED', 'DRAFT_STARTED', 'READY');

-- CreateEnum
CREATE TYPE "PhotoGroupStatus" AS ENUM ('PENDING', 'ANALYZING', 'ASSIGNED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IngestDecision" AS ENUM ('NEW_ITEM', 'ADDED_TO_ITEM', 'DUPLICATE_SKIPPED', 'GROUPED_PENDING', 'ERROR');

-- CreateEnum
CREATE TYPE "DeviceImportMethod" AS ENUM ('MASS_STORAGE', 'GVFS', 'GPHOTO2');

-- CreateEnum
CREATE TYPE "EbayDraftStatus" AS ENUM ('OPEN', 'SUBMITTED', 'ABANDONED', 'UNKNOWN');

-- CreateTable
CREATE TABLE "Item" (
    "id" TEXT NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "brand" TEXT,
    "model" TEXT,
    "category" TEXT,
    "ebayCategoryId" TEXT,
    "condition" TEXT,
    "conditionId" INTEGER,
    "features" TEXT[],
    "keywords" TEXT[],
    "itemSpecifics" JSONB,
    "upc" TEXT,
    "isbn" TEXT,
    "mpn" TEXT,
    "epid" TEXT,
    "startingPrice" DECIMAL(10,2),
    "buyNowPrice" DECIMAL(10,2),
    "shippingPrice" DECIMAL(10,2),
    "weightOz" DOUBLE PRECISION,
    "packageDimensions" JSONB,
    "listingFormat" TEXT,
    "listingDuration" TEXT,
    "returnPolicy" JSONB,
    "postalCode" TEXT,
    "ebayItemId" TEXT,
    "ebayListingUrl" TEXT,
    "status" "ItemStatus" NOT NULL DEFAULT 'DRAFT',
    "stage" "ItemStage" NOT NULL DEFAULT 'INGESTED',
    "aiAnalysis" JSONB,
    "aiCost" DECIMAL(10,4) NOT NULL DEFAULT 0,
    "completeness" JSONB,
    "sourceFolder" TEXT,
    "fingerprint" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Item_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Photo" (
    "id" TEXT NOT NULL,
    "itemId" TEXT,
    "photoGroupId" TEXT,
    "originalPath" TEXT NOT NULL,
    "thumbnailPath" TEXT,
    "optimizedPath" TEXT,
    "publicUrl" TEXT,
    "cdnUrl" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "order" INTEGER NOT NULL DEFAULT 0,
    "sha256" TEXT NOT NULL,
    "perceptualHash" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "bytes" INTEGER,
    "mime" TEXT,
    "capturedAt" TIMESTAMP(3),
    "exif" JSONB,
    "analysis" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Photo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PhotoGroup" (
    "id" TEXT NOT NULL,
    "itemId" TEXT,
    "sourceFolder" TEXT NOT NULL,
    "firstFilenameNumeric" INTEGER,
    "lastFilenameNumeric" INTEGER,
    "firstCapturedAt" TIMESTAMP(3),
    "lastCapturedAt" TIMESTAMP(3),
    "status" "PhotoGroupStatus" NOT NULL DEFAULT 'PENDING',
    "llmDecision" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PhotoGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IngestEvent" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "decision" "IngestDecision" NOT NULL,
    "itemId" TEXT,
    "groupId" TEXT,
    "llmCostUsd" DECIMAL(10,4),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IngestEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WatchFolder" (
    "id" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "includeGlobs" TEXT[] DEFAULT ARRAY['**/*.{jpg,jpeg,png,heic,heif,webp}']::TEXT[],
    "excludeGlobs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastScanAt" TIMESTAMP(3),
    "recursive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WatchFolder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Device" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "label" TEXT,
    "lastMountPath" TEXT,
    "lastImportedAt" TIMESTAMP(3),
    "autoImport" BOOLEAN NOT NULL DEFAULT false,
    "importSubdir" TEXT,
    "importMethod" "DeviceImportMethod" NOT NULL DEFAULT 'MASS_STORAGE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Device_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SoldCompLink" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "ebayItemId" TEXT NOT NULL,
    "soldPrice" DECIMAL(10,2),
    "soldDate" TIMESTAMP(3),
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "categoryId" TEXT,
    "categoryPath" TEXT,
    "condition" TEXT,
    "title" TEXT,
    "description" TEXT,
    "itemSpecifics" JSONB,
    "imageUrls" TEXT[],
    "sellerName" TEXT,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SoldCompLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EbayDraft" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "ebayDraftId" TEXT,
    "ebayDraftUrl" TEXT NOT NULL,
    "accountHint" TEXT,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastFilledAt" TIMESTAMP(3),
    "lastFilledFields" JSONB,
    "currentValues" JSONB,
    "status" "EbayDraftStatus" NOT NULL DEFAULT 'OPEN',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EbayDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "name" TEXT,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Machine" (
    "id" TEXT NOT NULL,
    "apiKeyId" TEXT NOT NULL,
    "machineId" TEXT NOT NULL,
    "userAgent" TEXT,
    "lastSeenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Machine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "Item_status_idx" ON "Item"("status");

-- CreateIndex
CREATE INDEX "Item_stage_idx" ON "Item"("stage");

-- CreateIndex
CREATE INDEX "Item_fingerprint_idx" ON "Item"("fingerprint");

-- CreateIndex
CREATE INDEX "Item_ebayItemId_idx" ON "Item"("ebayItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Photo_sha256_key" ON "Photo"("sha256");

-- CreateIndex
CREATE INDEX "Photo_itemId_idx" ON "Photo"("itemId");

-- CreateIndex
CREATE INDEX "Photo_photoGroupId_idx" ON "Photo"("photoGroupId");

-- CreateIndex
CREATE INDEX "Photo_perceptualHash_idx" ON "Photo"("perceptualHash");

-- CreateIndex
CREATE INDEX "Photo_capturedAt_idx" ON "Photo"("capturedAt");

-- CreateIndex
CREATE INDEX "PhotoGroup_sourceFolder_firstCapturedAt_idx" ON "PhotoGroup"("sourceFolder", "firstCapturedAt");

-- CreateIndex
CREATE INDEX "PhotoGroup_status_idx" ON "PhotoGroup"("status");

-- CreateIndex
CREATE INDEX "IngestEvent_sha256_idx" ON "IngestEvent"("sha256");

-- CreateIndex
CREATE INDEX "IngestEvent_createdAt_idx" ON "IngestEvent"("createdAt");

-- CreateIndex
CREATE INDEX "IngestEvent_decision_idx" ON "IngestEvent"("decision");

-- CreateIndex
CREATE UNIQUE INDEX "WatchFolder_path_key" ON "WatchFolder"("path");

-- CreateIndex
CREATE UNIQUE INDEX "Device_vendorId_productId_key" ON "Device"("vendorId", "productId");

-- CreateIndex
CREATE INDEX "SoldCompLink_itemId_idx" ON "SoldCompLink"("itemId");

-- CreateIndex
CREATE INDEX "SoldCompLink_ebayItemId_idx" ON "SoldCompLink"("ebayItemId");

-- CreateIndex
CREATE UNIQUE INDEX "SoldCompLink_itemId_ebayItemId_key" ON "SoldCompLink"("itemId", "ebayItemId");

-- CreateIndex
CREATE UNIQUE INDEX "EbayDraft_ebayDraftId_key" ON "EbayDraft"("ebayDraftId");

-- CreateIndex
CREATE INDEX "EbayDraft_itemId_idx" ON "EbayDraft"("itemId");

-- CreateIndex
CREATE INDEX "EbayDraft_status_idx" ON "EbayDraft"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_keyHash_key" ON "ApiKey"("keyHash");

-- CreateIndex
CREATE INDEX "ApiKey_clientId_idx" ON "ApiKey"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Machine_machineId_key" ON "Machine"("machineId");

-- CreateIndex
CREATE INDEX "Machine_apiKeyId_idx" ON "Machine"("apiKeyId");

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Photo" ADD CONSTRAINT "Photo_photoGroupId_fkey" FOREIGN KEY ("photoGroupId") REFERENCES "PhotoGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PhotoGroup" ADD CONSTRAINT "PhotoGroup_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IngestEvent" ADD CONSTRAINT "IngestEvent_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SoldCompLink" ADD CONSTRAINT "SoldCompLink_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EbayDraft" ADD CONSTRAINT "EbayDraft_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Item"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_apiKeyId_fkey" FOREIGN KEY ("apiKeyId") REFERENCES "ApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;
