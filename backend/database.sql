SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;

CREATE SCHEMA IF NOT EXISTS "public";
COMMENT ON SCHEMA "public" IS 'standard public schema';

-- gen_random_uuid() lives in pgcrypto on most Postgres versions.
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

SET default_tablespace = '';
SET default_table_access_method = "heap";

-- ============================================================================
-- TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS "public"."users" (
    "id"              uuid DEFAULT gen_random_uuid() NOT NULL,
    "username"        text NOT NULL,
    "email"           text,
    "password"        text,                         -- nullable: OAuth-only users have none
    "role"            text DEFAULT 'client'::text NOT NULL,
    "email_verified"  boolean DEFAULT false NOT NULL,
    "google_id"       text,                          -- Google OAuth "sub" claim, when linked
    "created_at"      timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "public"."email_verifications" (
    "id"          uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id"     uuid NOT NULL,
    "token_hash"  text NOT NULL,                     -- SHA-256 hash, same pattern as refresh_tokens
    "expires_at"  timestamp with time zone NOT NULL,
    "used_at"     timestamp with time zone,
    "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS "public"."client_profiles" (
    "id"           uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id"      uuid NOT NULL,
    "first_name"   text NOT NULL,
    "last_name"    text NOT NULL,
    "birthday"     date NOT NULL,
    "address"      text NOT NULL,
    "address_lat"  double precision,
    "address_lng"  double precision,
    "created_at"   timestamp with time zone DEFAULT now(),
    "updated_at"   timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "public"."analysis_services" (
    "id"          uuid DEFAULT gen_random_uuid() NOT NULL,
    "code"        text NOT NULL,
    "name"        text NOT NULL,
    "description" text,
    "price"       numeric(10,2) NOT NULL,
    "keywords"    text,
    "is_active"   boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS "public"."demands" (
    "id"               uuid DEFAULT gen_random_uuid() NOT NULL,
    "client_id"        uuid NOT NULL,
    "ordonnance_url"   text NOT NULL,
    "ordonnance_type"  text DEFAULT 'handwritten'::text NOT NULL,
    "status"           text DEFAULT 'pending'::text NOT NULL,
    "ocr_text"         text,
    "total_price"      numeric(10,2),
    "notes"            text,
    "created_at"       timestamp with time zone DEFAULT now(),
    "updated_at"       timestamp with time zone DEFAULT now(),
    "idempotency_key"  uuid
);

CREATE TABLE IF NOT EXISTS "public"."demand_items" (
    "id"          uuid DEFAULT gen_random_uuid() NOT NULL,
    "demand_id"   uuid NOT NULL,
    "service_id"  uuid NOT NULL,
    "price"       numeric(10,2) NOT NULL
);

-- Simple roster of nurses the lab dispatches for home visits.
-- Not user accounts: nurses don't log in, they're managed by workers.
CREATE TABLE IF NOT EXISTS "public"."nurses" (
    "id"                    uuid DEFAULT gen_random_uuid() NOT NULL,
    "name"                  text NOT NULL,
    "phone"                 text NOT NULL,
    "zone"                  text,                            -- free-text coverage area, e.g. "Tipaza / Kolea"
    "max_visits_per_day"    integer DEFAULT 6 NOT NULL,       -- capacity ceiling; varies per nurse (zone size, experience)
    "is_active"             boolean DEFAULT true NOT NULL,
    "created_at"            timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "public"."nurse_requests" (
    "id"                 uuid DEFAULT gen_random_uuid() NOT NULL,
    "demand_id"          uuid NOT NULL,
    "client_id"          uuid NOT NULL,
    "phone"              text NOT NULL,
    "address"            text NOT NULL,
    "address_lat"        double precision,
    "address_lng"        double precision,
    "status"             text DEFAULT 'pending'::text NOT NULL,
    "assigned_nurse_id"  uuid,                      -- who's actually going; set when worker confirms
    "preferred_date"     date NOT NULL,              -- client's requested visit day; required — "whenever" isn't a real slot
    "preferred_slot"     text NOT NULL,               -- 'morning' | 'afternoon' — matches how nurses actually do rounds
    -- Who ended it and why, when status is 'cancelled' or 'no_show'. NULL for
    -- any other status. Dead end by design: no reopening, client re-submits.
    "cancelled_by"       text,                        -- 'client' | 'worker'
    "cancelled_reason"   text,
    "cancelled_at"       timestamp with time zone,
    "created_at"         timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "public"."refresh_tokens" (
    "id"          uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id"     uuid NOT NULL,
    "token_hash"  text NOT NULL,
    "family_id"   uuid NOT NULL,
    "expires_at"  timestamp with time zone NOT NULL,
    "revoked_at"  timestamp with time zone,
    "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);

-- ============================================================================
-- PRIMARY KEYS / UNIQUE CONSTRAINTS
-- ============================================================================

ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_username_key" UNIQUE ("username");
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_email_key" UNIQUE ("email");
ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_google_id_key" UNIQUE ("google_id");

ALTER TABLE ONLY "public"."email_verifications"
    ADD CONSTRAINT "email_verifications_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."email_verifications"
    ADD CONSTRAINT "email_verifications_token_hash_key" UNIQUE ("token_hash");

ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."analysis_services"
    ADD CONSTRAINT "analysis_services_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."analysis_services"
    ADD CONSTRAINT "analysis_services_code_key" UNIQUE ("code");

ALTER TABLE ONLY "public"."demands"
    ADD CONSTRAINT "demands_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."demand_items"
    ADD CONSTRAINT "demand_items_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."nurses"
    ADD CONSTRAINT "nurses_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."nurses"
    ADD CONSTRAINT "nurses_max_visits_per_day_check" CHECK ("max_visits_per_day" > 0);

ALTER TABLE ONLY "public"."nurse_requests"
    ADD CONSTRAINT "nurse_requests_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id");
ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_token_hash_key" UNIQUE ("token_hash");

-- ============================================================================
-- FOREIGN KEYS
-- ============================================================================

ALTER TABLE ONLY "public"."email_verifications"
    ADD CONSTRAINT "email_verifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

ALTER TABLE ONLY "public"."client_profiles"
    ADD CONSTRAINT "client_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id");

ALTER TABLE ONLY "public"."demand_items"
    ADD CONSTRAINT "demand_items_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "public"."demands"("id");
ALTER TABLE ONLY "public"."demand_items"
    ADD CONSTRAINT "demand_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."analysis_services"("id");

ALTER TABLE ONLY "public"."demands"
    ADD CONSTRAINT "demands_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id");

ALTER TABLE ONLY "public"."nurse_requests"
    ADD CONSTRAINT "nurse_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."users"("id");
ALTER TABLE ONLY "public"."nurse_requests"
    ADD CONSTRAINT "nurse_requests_demand_id_fkey" FOREIGN KEY ("demand_id") REFERENCES "public"."demands"("id");
ALTER TABLE ONLY "public"."nurse_requests"
    ADD CONSTRAINT "nurse_requests_assigned_nurse_id_fkey" FOREIGN KEY ("assigned_nurse_id") REFERENCES "public"."nurses"("id") ON DELETE SET NULL;
ALTER TABLE ONLY "public"."nurse_requests"
    ADD CONSTRAINT "nurse_requests_preferred_slot_check" CHECK ("preferred_slot" IN ('morning', 'afternoon'));
ALTER TABLE ONLY "public"."nurse_requests"
    ADD CONSTRAINT "nurse_requests_status_check" CHECK ("status" IN ('pending', 'confirmed', 'done', 'cancelled', 'no_show'));
ALTER TABLE ONLY "public"."nurse_requests"
    ADD CONSTRAINT "nurse_requests_cancelled_by_check" CHECK ("cancelled_by" IS NULL OR "cancelled_by" IN ('client', 'worker'));

ALTER TABLE ONLY "public"."refresh_tokens"
    ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

-- ============================================================================
-- INDEXES
-- ============================================================================

CREATE INDEX "analysis_services_name_idx" ON "public"."analysis_services" USING btree ("name");

CREATE INDEX "client_profiles_user_id_idx" ON "public"."client_profiles" USING btree ("user_id");

CREATE INDEX "demand_items_demand_id_idx" ON "public"."demand_items" USING btree ("demand_id");

CREATE INDEX "demands_client_id_idx" ON "public"."demands" USING btree ("client_id");
CREATE INDEX "demands_created_at_idx" ON "public"."demands" USING btree ("created_at");
CREATE UNIQUE INDEX "idx_demands_idempotency" ON "public"."demands" USING btree ("idempotency_key") WHERE ("idempotency_key" IS NOT NULL);
CREATE INDEX "idx_demands_status" ON "public"."demands" USING btree ("status");
CREATE INDEX "idx_demands_status_created" ON "public"."demands" USING btree ("status", "created_at" DESC);

CREATE INDEX "idx_nurse_requests_client_id" ON "public"."nurse_requests" USING btree ("client_id");
CREATE INDEX "idx_nurse_requests_demand_id" ON "public"."nurse_requests" USING btree ("demand_id");
CREATE INDEX "nurse_requests_created_at_idx" ON "public"."nurse_requests" USING btree ("created_at");
CREATE INDEX "idx_nurse_requests_assigned_nurse_id" ON "public"."nurse_requests" USING btree ("assigned_nurse_id");
CREATE INDEX "idx_nurse_requests_preferred_date" ON "public"."nurse_requests" USING btree ("preferred_date");

CREATE INDEX "idx_nurses_is_active" ON "public"."nurses" USING btree ("is_active");

CREATE INDEX "idx_refresh_tokens_family" ON "public"."refresh_tokens" USING btree ("family_id");
CREATE INDEX "idx_refresh_tokens_hash" ON "public"."refresh_tokens" USING btree ("token_hash");
CREATE INDEX "idx_refresh_tokens_user" ON "public"."refresh_tokens" USING btree ("user_id");

CREATE INDEX "idx_email_verifications_user" ON "public"."email_verifications" USING btree ("user_id");
CREATE INDEX "idx_email_verifications_token_hash" ON "public"."email_verifications" USING btree ("token_hash");

-- ============================================================================
-- FUNCTIONS (RPC equivalents — unchanged from the Supabase original, portable
-- as-is; called directly via SQL from the new backend instead of supabase.rpc())
-- ============================================================================

CREATE OR REPLACE FUNCTION "public"."create_demand_with_items"(
    "p_client_id" uuid,
    "p_ordonnance_url" text,
    "p_ordonnance_type" text,
    "p_status" text,
    "p_ocr_text" text,
    "p_total_price" numeric,
    "p_items" jsonb,
    "p_idempotency_key" uuid DEFAULT NULL::uuid
) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
DECLARE
  v_demand_id UUID;
BEGIN
  INSERT INTO demands (client_id, ordonnance_url, ordonnance_type, status, ocr_text, total_price, idempotency_key)
  VALUES (p_client_id, p_ordonnance_url, p_ordonnance_type, p_status, p_ocr_text, p_total_price, p_idempotency_key)
  RETURNING id INTO v_demand_id;

  INSERT INTO demand_items (demand_id, service_id, price)
  SELECT v_demand_id, (item->>'service_id')::UUID, (item->>'price')::DECIMAL
  FROM jsonb_array_elements(p_items) AS item;

  RETURN jsonb_build_object('id', v_demand_id);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Failed to create demand: %', SQLERRM;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."process_demand_with_items"(
    "p_demand_id" uuid,
    "p_total_price" numeric,
    "p_notes" text,
    "p_items" jsonb
) RETURNS jsonb
    LANGUAGE plpgsql
    AS $$
BEGIN
  DELETE FROM demand_items WHERE demand_id = p_demand_id;

  INSERT INTO demand_items (demand_id, service_id, price)
  SELECT p_demand_id, (item->>'service_id')::UUID, (item->>'price')::DECIMAL
  FROM jsonb_array_elements(p_items) AS item;

  UPDATE demands
  SET status = 'processed', total_price = p_total_price, notes = p_notes, updated_at = NOW()
  WHERE id = p_demand_id;

  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RAISE EXCEPTION 'Failed to process demand: %', SQLERRM;
END;
$$;

CREATE TABLE IF NOT EXISTS "public"."oauth_exchange_codes" (
    "id"          uuid DEFAULT gen_random_uuid() NOT NULL,
    "user_id"     uuid NOT NULL,
    "code_hash"   text NOT NULL,
    "expires_at"  timestamp with time zone NOT NULL,
    "used_at"     timestamp with time zone,
    "created_at"  timestamp with time zone DEFAULT now() NOT NULL
);

ALTER TABLE ONLY "public"."oauth_exchange_codes"
    ADD CONSTRAINT "oauth_exchange_codes_pkey" PRIMARY KEY ("id");

ALTER TABLE ONLY "public"."oauth_exchange_codes"
    ADD CONSTRAINT "oauth_exchange_codes_code_hash_key" UNIQUE ("code_hash");

ALTER TABLE ONLY "public"."oauth_exchange_codes"
    ADD CONSTRAINT "oauth_exchange_codes_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE CASCADE;

CREATE INDEX "idx_oauth_exchange_codes_user"      ON "public"."oauth_exchange_codes" USING btree ("user_id");
CREATE INDEX "idx_oauth_exchange_codes_code_hash" ON "public"."oauth_exchange_codes" USING btree ("code_hash");


-- Run this once against the app's Postgres database before deploying.
-- Mirrors the shape/pattern of the existing email_verifications table.

CREATE TABLE IF NOT EXISTS password_resets (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  expires_at  TIMESTAMPTZ NOT NULL,
  used_at     TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON password_resets(user_id);