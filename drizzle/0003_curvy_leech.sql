CREATE TABLE "AppModule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"icon" text,
	"sortOrder" integer DEFAULT 0 NOT NULL,
	"isSystem" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "AppModule_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "TenantModule" (
	"tenantId" uuid NOT NULL,
	"moduleId" uuid NOT NULL,
	"isEnabled" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "TenantModule_tenantId_moduleId_pk" PRIMARY KEY("tenantId","moduleId")
);
--> statement-breakpoint
TRUNCATE TABLE "Permission" CASCADE;--> statement-breakpoint
DROP INDEX "Permission_category_idx";--> statement-breakpoint
ALTER TABLE "Permission" ALTER COLUMN "category" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "Permission" ADD COLUMN "moduleId" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "Permission" ADD COLUMN "action" text DEFAULT 'manage' NOT NULL;--> statement-breakpoint
ALTER TABLE "TenantModule" ADD CONSTRAINT "TenantModule_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantModule" ADD CONSTRAINT "TenantModule_moduleId_AppModule_id_fk" FOREIGN KEY ("moduleId") REFERENCES "public"."AppModule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "AppModule_sortOrder_idx" ON "AppModule" USING btree ("sortOrder");--> statement-breakpoint
CREATE INDEX "TenantModule_tenantId_idx" ON "TenantModule" USING btree ("tenantId");--> statement-breakpoint
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_moduleId_AppModule_id_fk" FOREIGN KEY ("moduleId") REFERENCES "public"."AppModule"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "Permission_moduleId_idx" ON "Permission" USING btree ("moduleId");