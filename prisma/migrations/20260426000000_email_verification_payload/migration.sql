ALTER TABLE "EmailToken" ADD COLUMN "payload" JSONB;

CREATE INDEX "EmailToken_email_type_tokenHash_idx" ON "EmailToken"("email", "type", "tokenHash");
CREATE INDEX "EmailToken_expiresAt_idx" ON "EmailToken"("expiresAt");
