CREATE TYPE "public"."scim_token_status" AS ENUM('ACTIVE', 'REVOKED');--> statement-breakpoint
CREATE TYPE "public"."sso_provider_type" AS ENUM('SAML', 'OIDC');--> statement-breakpoint
CREATE TYPE "public"."sso_status" AS ENUM('DISABLED', 'ACTIVE');--> statement-breakpoint
CREATE TABLE "tenant_scim_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"token_prefix" text NOT NULL,
	"status" "scim_token_status" DEFAULT 'ACTIVE' NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tenant_scim_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "tenant_sso_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider_type" "sso_provider_type" DEFAULT 'SAML' NOT NULL,
	"status" "sso_status" DEFAULT 'DISABLED' NOT NULL,
	"idp_entity_id" text,
	"idp_sso_url" text,
	"idp_certificate" text,
	"oidc_client_id" text,
	"oidc_client_secret" text,
	"oidc_discovery_url" text,
	"enforce_sso" boolean DEFAULT false NOT NULL,
	"allowed_domains" text[] DEFAULT '{}' NOT NULL,
	"default_role_id" uuid,
	"jit_provisioning" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tenant_scim_tokens" ADD CONSTRAINT "tenant_scim_tokens_tenant_id_Tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_scim_tokens" ADD CONSTRAINT "tenant_scim_tokens_created_by_user_id_User_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_sso_configs" ADD CONSTRAINT "tenant_sso_configs_tenant_id_Tenant_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_sso_configs" ADD CONSTRAINT "tenant_sso_configs_default_role_id_AppRole_id_fk" FOREIGN KEY ("default_role_id") REFERENCES "public"."AppRole"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tenant_sso_configs_tenant_id_unique" ON "tenant_sso_configs" USING btree ("tenant_id");