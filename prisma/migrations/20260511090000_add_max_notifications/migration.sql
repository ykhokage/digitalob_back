-- Add Max messenger support for notification delivery.
ALTER TYPE "NotificationChannel" ADD VALUE IF NOT EXISTS 'MAX';

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "maxUserId" TEXT;
