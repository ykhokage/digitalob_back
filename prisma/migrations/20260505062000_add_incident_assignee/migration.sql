ALTER TABLE "Incident" ADD COLUMN "assignedToId" TEXT;

ALTER TABLE "Incident" ADD CONSTRAINT "Incident_assignedToId_fkey"
  FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Incident_assignedToId_idx" ON "Incident"("assignedToId");
