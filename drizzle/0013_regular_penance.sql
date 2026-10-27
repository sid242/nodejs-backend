CREATE TABLE "Invoice" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"subscriptionId" uuid,
	"planId" uuid,
	"invoiceNumber" text NOT NULL,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"amountCents" integer DEFAULT 0 NOT NULL,
	"taxCents" integer DEFAULT 0 NOT NULL,
	"totalCents" integer DEFAULT 0 NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"lineItems" jsonb DEFAULT '[]'::jsonb,
	"billingPeriodStart" timestamp (3),
	"billingPeriodEnd" timestamp (3),
	"dueDate" timestamp (3),
	"paidAt" timestamp (3),
	"pdfUrl" text,
	"providerInvoiceId" text,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscriptionId_Subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_planId_Plan_id_fk" FOREIGN KEY ("planId") REFERENCES "public"."Plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "Invoice_invoiceNumber_unique" ON "Invoice" USING btree ("invoiceNumber");--> statement-breakpoint
CREATE INDEX "Invoice_tenantId_idx" ON "Invoice" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "Invoice_subscriptionId_idx" ON "Invoice" USING btree ("subscriptionId");--> statement-breakpoint
CREATE INDEX "Invoice_status_idx" ON "Invoice" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Invoice_createdAt_idx" ON "Invoice" USING btree ("createdAt");