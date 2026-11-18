CREATE TABLE "TenantSetting" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"locale" text DEFAULT 'en-US' NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"dateFormat" text DEFAULT 'YYYY-MM-DD' NOT NULL,
	"timeFormat" text DEFAULT '24h' NOT NULL,
	"weekStartsOn" text DEFAULT 'monday' NOT NULL,
	"fiscalYearStartMonth" integer DEFAULT 1 NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"industry" text,
	"companySize" text,
	"legalName" text,
	"taxId" text,
	"billingAddressId" uuid,
	"supportEmail" text,
	"websiteUrl" text,
	"termsUrl" text,
	"privacyUrl" text,
	"defaultMemberRoleId" uuid,
	"allowedEmailDomains" text[] DEFAULT '{}'::text[] NOT NULL,
	"autoJoinDomains" boolean DEFAULT false NOT NULL,
	"memberLimitNotified" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "TenantSecurityPolicy" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"requireMfa" text DEFAULT 'NONE' NOT NULL,
	"passwordMinLength" integer DEFAULT 8 NOT NULL,
	"passwordMaxAgeDays" integer,
	"sessionIdleMinutes" integer DEFAULT 60 NOT NULL,
	"sessionMaxHours" integer DEFAULT 24 NOT NULL,
	"ipAllowlist" text[] DEFAULT '{}'::text[] NOT NULL,
	"allowedAuthMethods" text[] DEFAULT ARRAY['PASSWORD', 'MAGIC', 'SSO']::text[] NOT NULL,
	"enforceSso" boolean DEFAULT false NOT NULL,
	"allowSupportAccess" boolean DEFAULT true NOT NULL,
	"inviteExpiryDays" integer DEFAULT 7 NOT NULL,
	"allowPersonalEmails" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "TenantSetting" ADD CONSTRAINT "TenantSetting_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantSetting" ADD CONSTRAINT "TenantSetting_billingAddressId_Address_id_fk" FOREIGN KEY ("billingAddressId") REFERENCES "public"."Address"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantSetting" ADD CONSTRAINT "TenantSetting_defaultMemberRoleId_AppRole_id_fk" FOREIGN KEY ("defaultMemberRoleId") REFERENCES "public"."AppRole"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "TenantSecurityPolicy" ADD CONSTRAINT "TenantSecurityPolicy_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "TenantSetting_tenantId_idx" ON "TenantSetting" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "TenantSetting_createdAt_idx" ON "TenantSetting" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "TenantSecurityPolicy_tenantId_idx" ON "TenantSecurityPolicy" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "TenantSecurityPolicy_createdAt_idx" ON "TenantSecurityPolicy" USING btree ("createdAt");