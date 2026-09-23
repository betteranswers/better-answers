-- Custom migration (hand-written SQL; ADR 0032).
-- Catalogue-only, and safe beneath an image still writing a value: a nullable column accepts it.
ALTER TABLE "index".chunk ALTER COLUMN "sensitivity" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "index".chunk ALTER COLUMN "audience" DROP NOT NULL;
