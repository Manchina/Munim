ALTER TABLE "customer_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "customers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "inventory_balances" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "account_invites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "khata_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "store_memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "product_aliases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "receipt_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "restock_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sale_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sales" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stock_movements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "stores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "suppliers" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Fastify is the only public interface to these server-owned tables.
DO $$
DECLARE app_table text; api_role text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'users','stores','store_memberships','sessions','account_invites',
    'suppliers','products','product_aliases','inventory_balances',
    'customers','customer_aliases','sales','sale_items','khata_entries',
    'restock_requests','stock_movements','idempotency_records','receipt_links'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE %I FROM PUBLIC',app_table);
    FOREACH api_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=api_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE %I FROM %I',app_table,api_role);
      END IF;
    END LOOP;
  END LOOP;
END;
$$;
