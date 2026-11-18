CREATE TABLE "InvoiceSequence" (
	"year" integer NOT NULL,
	"nextSeq" integer DEFAULT 1 NOT NULL,
	"updatedAt" timestamp (3) DEFAULT now() NOT NULL,
	CONSTRAINT "InvoiceSequence_pkey" PRIMARY KEY("year")
);
--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "isFeatured" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "badge" text;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "features" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "pricePerSeatMinor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "includedSeats" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "version" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "ctaLabel" text DEFAULT 'Get Started';--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "priceSnapshotMinor" integer;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "currency" text DEFAULT 'INR' NOT NULL;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "pausedAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "canceledAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "cancelReason" text;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "defaultPaymentMethodId" text;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "couponId" text;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "scheduledPlanId" uuid;--> statement-breakpoint
ALTER TABLE "Subscription" ADD COLUMN "taxIdSnapshot" text;--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN "subtotalMinor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN "discountMinor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN "taxBreakdown" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN "customerSnapshot" jsonb;--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN "creditedMinor" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN "attemptCount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN "nextAttemptAt" timestamp (3);--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN "invoiceYear" integer;--> statement-breakpoint
ALTER TABLE "Invoice" ADD COLUMN "invoiceSeq" integer;--> statement-breakpoint
CREATE INDEX "Invoice_year_seq_idx" ON "Invoice" USING btree ("invoiceYear","invoiceSeq");