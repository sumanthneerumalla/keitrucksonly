-- CSP violation report sink (report-uri / report-to) for the Content-Security-
-- Policy rollout. See src/lib/csp.ts + src/app/api/csp-report/route.ts. Browser-
-- supplied, append-only; read via the DB console and prune once enforce is stable.

-- CreateTable
CREATE TABLE "CspReport" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clerkUserId" VARCHAR(64),
    "ip" VARCHAR(64),
    "disposition" VARCHAR(20),
    "documentUri" TEXT,
    "referrer" TEXT,
    "blockedUri" TEXT,
    "effectiveDirective" VARCHAR(255),
    "violatedDirective" VARCHAR(255),
    "originalPolicy" TEXT,
    "sourceFile" TEXT,
    "lineNumber" INTEGER,
    "columnNumber" INTEGER,
    "scriptSample" TEXT,
    "statusCode" INTEGER,
    "userAgent" TEXT,
    "raw" JSONB,

    CONSTRAINT "CspReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CspReport_createdAt_idx" ON "CspReport"("createdAt");

-- CreateIndex
CREATE INDEX "CspReport_effectiveDirective_idx" ON "CspReport"("effectiveDirective");

-- CreateIndex
CREATE INDEX "CspReport_clerkUserId_idx" ON "CspReport"("clerkUserId");
