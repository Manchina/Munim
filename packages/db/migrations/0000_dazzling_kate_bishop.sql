CREATE TABLE "customer_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"alias" text NOT NULL,
	CONSTRAINT "customer_aliases_store_id_customer_id_alias_unique" UNIQUE("store_id","customer_id","alias")
);
--> statement-breakpoint
CREATE TABLE "customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_store_id_id_unique" UNIQUE("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"store_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_records_store_id_operation_key_unique" UNIQUE("store_id","operation","key")
);
--> statement-breakpoint
CREATE TABLE "inventory_balances" (
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "inventory_balances_store_id_product_id_unique" UNIQUE("store_id","product_id"),
	CONSTRAINT "inventory_nonnegative" CHECK ("inventory_balances"."quantity" >= 0)
);
--> statement-breakpoint
CREATE TABLE "account_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text DEFAULT 'staff' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "account_invites_token_hash_unique" UNIQUE("token_hash"),
	CONSTRAINT "invite_role" CHECK ("account_invites"."role" IN ('owner','staff'))
);
--> statement-breakpoint
CREATE TABLE "khata_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"amount_paise" bigint NOT NULL,
	"sale_id" uuid,
	"method" text,
	"reference" text,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "khata_entries_store_id_sale_id_unique" UNIQUE("store_id","sale_id"),
	CONSTRAINT "khata_values" CHECK ("khata_entries"."amount_paise" BETWEEN 1 AND 9007199254740991 AND (("khata_entries"."kind" = 'sale_debit' AND "khata_entries"."sale_id" IS NOT NULL AND "khata_entries"."method" IS NULL) OR ("khata_entries"."kind" = 'payment' AND "khata_entries"."sale_id" IS NULL AND "khata_entries"."method" IN ('cash','upi'))))
);
--> statement-breakpoint
CREATE TABLE "store_memberships" (
	"store_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	CONSTRAINT "store_memberships_store_id_user_id_unique" UNIQUE("store_id","user_id"),
	CONSTRAINT "membership_role" CHECK ("store_memberships"."role" IN ('owner','staff'))
);
--> statement-breakpoint
CREATE TABLE "product_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"alias" text NOT NULL,
	CONSTRAINT "product_aliases_store_id_product_id_alias_unique" UNIQUE("store_id","product_id","alias")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"variant" text DEFAULT '' NOT NULL,
	"sku" text,
	"base_unit" text NOT NULL,
	"price_quantity" integer NOT NULL,
	"price_paise" bigint NOT NULL,
	"safety_stock" integer DEFAULT 0 NOT NULL,
	"supplier_id" uuid,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_store_id_id_unique" UNIQUE("store_id","id"),
	CONSTRAINT "products_store_id_sku_unique" UNIQUE("store_id","sku"),
	CONSTRAINT "product_values" CHECK ("products"."base_unit" IN ('gram','each') AND "products"."price_quantity" > 0 AND "products"."price_paise" BETWEEN 0 AND 9007199254740991 AND "products"."safety_stock" >= 0)
);
--> statement-breakpoint
CREATE TABLE "receipt_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"creator_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_links_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "restock_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid,
	"name" text NOT NULL,
	"variant" text DEFAULT '' NOT NULL,
	"demand_key" text NOT NULL,
	"supplier_id" uuid,
	"request_count" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"procured_at" timestamp with time zone,
	"actor_id" uuid,
	CONSTRAINT "restock_requests_store_id_id_unique" UNIQUE("store_id","id"),
	CONSTRAINT "restock_values" CHECK ("restock_requests"."request_count" > 0 AND "restock_requests"."status" IN ('open','procured'))
);
--> statement-breakpoint
CREATE TABLE "sale_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"sale_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"name" text NOT NULL,
	"variant" text NOT NULL,
	"base_unit" text NOT NULL,
	"quantity" integer NOT NULL,
	"price_quantity" integer NOT NULL,
	"price_paise" bigint NOT NULL,
	"line_total_paise" bigint NOT NULL,
	CONSTRAINT "sale_items_store_id_id_unique" UNIQUE("store_id","id"),
	CONSTRAINT "sale_item_values" CHECK ("sale_items"."quantity" > 0 AND "sale_items"."price_quantity" > 0 AND "sale_items"."base_unit" IN ('gram','each') AND "sale_items"."price_paise" BETWEEN 0 AND 9007199254740991 AND "sale_items"."line_total_paise" BETWEEN 0 AND 9007199254740991)
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"customer_id" uuid,
	"payment_method" text NOT NULL,
	"total_paise" bigint NOT NULL,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_store_id_id_unique" UNIQUE("store_id","id"),
	CONSTRAINT "sale_values" CHECK ("sales"."total_paise" BETWEEN 0 AND 9007199254740991 AND "sales"."payment_method" IN ('cash','upi','credit') AND ("sales"."payment_method" <> 'credit' OR "sales"."customer_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "stock_movements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"kind" text NOT NULL,
	"sale_item_id" uuid,
	"restock_request_id" uuid,
	"reason" text,
	"actor_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_movements_store_id_sale_item_id_unique" UNIQUE("store_id","sale_item_id"),
	CONSTRAINT "movement_values" CHECK ("stock_movements"."delta" <> 0 AND "stock_movements"."kind" IN ('opening','sale','receipt','adjustment') AND ("stock_movements"."kind" <> 'adjustment' OR length("stock_movements"."reason") > 0))
);
--> statement-breakpoint
CREATE TABLE "stores" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"credit_confirmation_threshold_paise" bigint DEFAULT 100000 NOT NULL,
	"pav_grams" integer,
	"upi_payee" text,
	"upi_name" text,
	"settings_version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "store_threshold" CHECK ("stores"."credit_confirmation_threshold_paise" BETWEEN 0 AND 9007199254740991),
	CONSTRAINT "store_pav" CHECK ("stores"."pav_grams" IS NULL OR "stores"."pav_grams" > 0)
);
--> statement-breakpoint
CREATE TABLE "suppliers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"store_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "suppliers_store_id_id_unique" UNIQUE("store_id","id")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "customer_aliases" ADD CONSTRAINT "customer_aliases_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_aliases" ADD CONSTRAINT "customer_aliases_store_id_customer_id_customers_store_id_id_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "public"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customers" ADD CONSTRAINT "customers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_balances" ADD CONSTRAINT "inventory_balances_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_invites" ADD CONSTRAINT "account_invites_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "khata_entries" ADD CONSTRAINT "khata_entries_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "khata_entries" ADD CONSTRAINT "khata_entries_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "khata_entries" ADD CONSTRAINT "khata_entries_store_id_customer_id_customers_store_id_id_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "public"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "khata_entries" ADD CONSTRAINT "khata_entries_store_id_sale_id_sales_store_id_id_fk" FOREIGN KEY ("store_id","sale_id") REFERENCES "public"."sales"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_memberships" ADD CONSTRAINT "store_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_aliases" ADD CONSTRAINT "product_aliases_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_store_id_supplier_id_suppliers_store_id_id_fk" FOREIGN KEY ("store_id","supplier_id") REFERENCES "public"."suppliers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_links" ADD CONSTRAINT "receipt_links_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_links" ADD CONSTRAINT "receipt_links_creator_id_users_id_fk" FOREIGN KEY ("creator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_links" ADD CONSTRAINT "receipt_links_store_id_sale_id_sales_store_id_id_fk" FOREIGN KEY ("store_id","sale_id") REFERENCES "public"."sales"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_requests" ADD CONSTRAINT "restock_requests_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_requests" ADD CONSTRAINT "restock_requests_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_requests" ADD CONSTRAINT "restock_requests_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "restock_requests" ADD CONSTRAINT "restock_requests_store_id_supplier_id_suppliers_store_id_id_fk" FOREIGN KEY ("store_id","supplier_id") REFERENCES "public"."suppliers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_store_id_sale_id_sales_store_id_id_fk" FOREIGN KEY ("store_id","sale_id") REFERENCES "public"."sales"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sale_items" ADD CONSTRAINT "sale_items_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_store_id_customer_id_customers_store_id_id_fk" FOREIGN KEY ("store_id","customer_id") REFERENCES "public"."customers"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_product_id_products_store_id_id_fk" FOREIGN KEY ("store_id","product_id") REFERENCES "public"."products"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_sale_item_id_sale_items_store_id_id_fk" FOREIGN KEY ("store_id","sale_item_id") REFERENCES "public"."sale_items"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_store_id_restock_request_id_restock_requests_store_id_id_fk" FOREIGN KEY ("store_id","restock_request_id") REFERENCES "public"."restock_requests"("store_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "customer_lookup" ON "customers" USING btree ("store_id","name");--> statement-breakpoint
CREATE INDEX "khata_history" ON "khata_entries" USING btree ("store_id","customer_id","created_at");--> statement-breakpoint
CREATE INDEX "product_alias_lookup" ON "product_aliases" USING btree ("store_id","alias");--> statement-breakpoint
CREATE INDEX "product_search" ON "products" USING btree ("store_id","normalized_name");--> statement-breakpoint
CREATE INDEX "receipt_expiry" ON "receipt_links" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_open_demand" ON "restock_requests" USING btree ("store_id","demand_key") WHERE "restock_requests"."status" = 'open';--> statement-breakpoint
CREATE INDEX "sales_history" ON "sales" USING btree ("store_id","created_at");--> statement-breakpoint
CREATE INDEX "session_expiry" ON "sessions" USING btree ("expires_at");