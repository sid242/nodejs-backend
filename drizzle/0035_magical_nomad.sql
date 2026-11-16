CREATE TABLE "PlatformRolePolicy" (
	"roleId" uuid NOT NULL,
	"policyId" uuid NOT NULL,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "PlatformRolePolicy_roleId_policyId_pk" PRIMARY KEY("roleId","policyId")
);
--> statement-breakpoint
ALTER TABLE "PlatformRolePolicy" ADD CONSTRAINT "PlatformRolePolicy_roleId_PlatformRole_id_fk" FOREIGN KEY ("roleId") REFERENCES "public"."PlatformRole"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "PlatformRolePolicy" ADD CONSTRAINT "PlatformRolePolicy_policyId_Policy_id_fk" FOREIGN KEY ("policyId") REFERENCES "public"."Policy"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "PlatformRolePolicy_roleId_idx" ON "PlatformRolePolicy" USING btree ("roleId");--> statement-breakpoint
CREATE INDEX "PlatformRolePolicy_policyId_idx" ON "PlatformRolePolicy" USING btree ("policyId");