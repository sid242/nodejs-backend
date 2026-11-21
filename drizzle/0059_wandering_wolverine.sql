DROP INDEX "Payment_providerPaymentId_idx";--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "razorpayPlanIdMonthly" text;--> statement-breakpoint
ALTER TABLE "Plan" ADD COLUMN "razorpayPlanIdYearly" text;--> statement-breakpoint
CREATE UNIQUE INDEX "Payment_providerPaymentId_unique" ON "Payment" USING btree ("providerPaymentId");