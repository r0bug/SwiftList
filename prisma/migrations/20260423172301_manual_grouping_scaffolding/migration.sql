-- AlterEnum
ALTER TYPE "ItemStatus" ADD VALUE 'IN_PROCESS';

-- AlterTable
ALTER TABLE "PhotoGroup" ADD COLUMN     "label" TEXT;
