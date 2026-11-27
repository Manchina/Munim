-- Financial and stock history must remain auditable, including outside the API.
CREATE FUNCTION munim_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Munim audit records are append-only' USING ERRCODE = '23514';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER sales_append_only BEFORE UPDATE OR DELETE ON sales
FOR EACH ROW EXECUTE FUNCTION munim_append_only();
--> statement-breakpoint
CREATE TRIGGER sale_items_append_only BEFORE UPDATE OR DELETE ON sale_items
FOR EACH ROW EXECUTE FUNCTION munim_append_only();
--> statement-breakpoint
CREATE TRIGGER khata_entries_append_only BEFORE UPDATE OR DELETE ON khata_entries
FOR EACH ROW EXECUTE FUNCTION munim_append_only();
--> statement-breakpoint
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
FOR EACH ROW EXECUTE FUNCTION munim_append_only();
