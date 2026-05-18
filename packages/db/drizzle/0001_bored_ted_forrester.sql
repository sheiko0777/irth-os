CREATE TYPE "public"."order_status" AS ENUM('pending', 'confirmed', 'payment_failed', 'shipped', 'delivered', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."shipping_provider" AS ENUM('bosta', 'mylerz');--> statement-breakpoint
CREATE TABLE "shipment_tracking" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider" "shipping_provider" NOT NULL,
	"tracking_number" varchar(255),
	"status" varchar(100),
	"raw_payload" jsonb DEFAULT '{}'::jsonb
);
--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DEFAULT 'pending'::"public"."order_status";--> statement-breakpoint
ALTER TABLE "orders" ALTER COLUMN "status" SET DATA TYPE "public"."order_status" USING "status"::"public"."order_status";--> statement-breakpoint
ALTER TABLE "shipment_tracking" ADD CONSTRAINT "shipment_tracking_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE no action ON UPDATE no action;