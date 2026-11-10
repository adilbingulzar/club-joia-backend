-- AlterTable
ALTER TABLE "event_program_items" ADD COLUMN     "icon" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "alert_by_email" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "alert_by_whatsapp" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "concierge_categories" "ConciergeCategory"[] DEFAULT ARRAY[]::"ConciergeCategory"[],
ADD COLUMN     "whatsapp_number" TEXT;
