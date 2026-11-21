ALTER TABLE "TenantMember" ADD COLUMN "departmentId" text;--> statement-breakpoint
ALTER TABLE "TenantMember" ADD COLUMN "regionId" text;--> statement-breakpoint
CREATE INDEX "TenantMember_departmentId_idx" ON "TenantMember" USING btree ("departmentId");--> statement-breakpoint
CREATE INDEX "TenantMember_regionId_idx" ON "TenantMember" USING btree ("regionId");