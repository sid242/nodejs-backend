CREATE TABLE "Payment" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"subscriptionId" uuid,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"providerOrderId" text,
	"providerPaymentId" text,
	"providerInvoiceId" text,
	"providerSignature" text,
	"amountMinor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'CREATED' NOT NULL,
	"paymentMethod" text,
	"failureCode" text,
	"failureDescription" text,
	"paidAt" timestamp (3),
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Refund" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"paymentId" uuid NOT NULL,
	"provider" text DEFAULT 'razorpay' NOT NULL,
	"providerRefundId" text,
	"amountMinor" integer NOT NULL,
	"currency" text DEFAULT 'INR' NOT NULL,
	"status" text DEFAULT 'INITIATED' NOT NULL,
	"reason" text,
	"requestedBy" text NOT NULL,
	"processedAt" timestamp (3),
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SubscriptionChange" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenantId" uuid NOT NULL,
	"subscriptionId" uuid NOT NULL,
	"fromPlanId" uuid,
	"toPlanId" uuid,
	"changeType" text NOT NULL,
	"effectiveAt" timestamp (3),
	"prorationAmountMinor" integer,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"requestedBy" text NOT NULL,
	"metadata" jsonb,
	"createdAt" timestamp (3) DEFAULT now() NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_Subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_Payment_id_fk" FOREIGN KEY ("paymentId") REFERENCES "public"."Payment"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_tenantId_Tenant_id_fk" FOREIGN KEY ("tenantId") REFERENCES "public"."Tenant"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_subscriptionId_Subscription_id_fk" FOREIGN KEY ("subscriptionId") REFERENCES "public"."Subscription"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_fromPlanId_Plan_id_fk" FOREIGN KEY ("fromPlanId") REFERENCES "public"."Plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "SubscriptionChange" ADD CONSTRAINT "SubscriptionChange_toPlanId_Plan_id_fk" FOREIGN KEY ("toPlanId") REFERENCES "public"."Plan"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "Payment_providerOrderId_unique" ON "Payment" USING btree ("providerOrderId");--> statement-breakpoint
CREATE INDEX "Payment_tenantId_idx" ON "Payment" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "Payment_subscriptionId_idx" ON "Payment" USING btree ("subscriptionId");--> statement-breakpoint
CREATE INDEX "Payment_status_idx" ON "Payment" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Payment_providerPaymentId_idx" ON "Payment" USING btree ("providerPaymentId");--> statement-breakpoint
CREATE INDEX "Payment_createdAt_idx" ON "Payment" USING btree ("createdAt");--> statement-breakpoint
CREATE UNIQUE INDEX "Refund_providerRefundId_unique" ON "Refund" USING btree ("providerRefundId");--> statement-breakpoint
CREATE INDEX "Refund_tenantId_idx" ON "Refund" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "Refund_paymentId_idx" ON "Refund" USING btree ("paymentId");--> statement-breakpoint
CREATE INDEX "Refund_status_idx" ON "Refund" USING btree ("status");--> statement-breakpoint
CREATE INDEX "Refund_createdAt_idx" ON "Refund" USING btree ("createdAt");--> statement-breakpoint
CREATE INDEX "SubscriptionChange_tenantId_idx" ON "SubscriptionChange" USING btree ("tenantId");--> statement-breakpoint
CREATE INDEX "SubscriptionChange_subscriptionId_idx" ON "SubscriptionChange" USING btree ("subscriptionId");--> statement-breakpoint
CREATE INDEX "SubscriptionChange_status_idx" ON "SubscriptionChange" USING btree ("status");--> statement-breakpoint
CREATE INDEX "SubscriptionChange_createdAt_idx" ON "SubscriptionChange" USING btree ("createdAt");