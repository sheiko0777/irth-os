DO $$ BEGIN
 CREATE TYPE "payment_method" AS ENUM('cod', 'online');
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "orders" ADD COLUMN "payment_method" "payment_method";
