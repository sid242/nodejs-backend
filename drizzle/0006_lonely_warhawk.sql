CREATE INDEX "File_tenantId_status_createdAt_idx" ON "File" USING btree ("tenantId","status","createdAt");--> statement-breakpoint
CREATE INDEX "TenantMember_tenantId_status_createdAt_idx" ON "TenantMember" USING btree ("tenantId","status","createdAt");--> statement-breakpoint
CREATE INDEX "AppRole_tenantId_createdAt_idx" ON "AppRole" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog" USING btree ("tenantId","createdAt");--> statement-breakpoint
CREATE INDEX "AuditLog_tenantId_userId_createdAt_idx" ON "AuditLog" USING btree ("tenantId","userId","createdAt");--> statement-breakpoint
CREATE INDEX "AuditLog_tenantId_entityType_entityId_idx" ON "AuditLog" USING btree ("tenantId","entityType","entityId");