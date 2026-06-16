-- Phase 10c: membership family-coverage hint + flexible add-on fee menu.
-- All additive (defaults supplied) — no data loss, no backfill needed.

-- MembershipPlan: covered-people hint (display only; 1=individual, N>1/null=shares
-- with family) + add-on fee menu (JSON config).
ALTER TABLE "MembershipPlan" ADD COLUMN "memberCapacity" INTEGER DEFAULT 1;
ALTER TABLE "MembershipPlan" ADD COLUMN "addOnFees" JSONB;

-- MemberMembership: snapshot of the plan's memberCapacity at sale time.
ALTER TABLE "MemberMembership" ADD COLUMN "memberCapacity" INTEGER DEFAULT 1;
