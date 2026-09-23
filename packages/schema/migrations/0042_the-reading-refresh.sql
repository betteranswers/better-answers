-- Custom migration (hand-written SQL; ADR 0032).
GRANT SELECT (category, tier, score, rule_version, detector_pin) ON "finding" TO worker_rt;--> statement-breakpoint
GRANT UPDATE (category, tier, score, rule_version, detector_pin) ON "finding" TO worker_rt;
