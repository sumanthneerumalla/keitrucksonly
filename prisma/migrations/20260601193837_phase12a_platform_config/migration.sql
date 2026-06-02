-- Phase 12a — interim PlatformConfig key/value store for processor secrets
-- when env vars can't be set on the server (no-SSH workaround).
-- Env vars take priority; code only reads this table when env is blank.
-- Cleanup: delete rows once env vars are restored.

CREATE TABLE "PlatformConfig" (
    "key" VARCHAR(100) NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "PlatformConfig_pkey" PRIMARY KEY ("key")
);
