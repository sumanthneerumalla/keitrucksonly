-- AlterTable
ALTER TABLE "Club" ADD COLUMN     "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "Invoice" (
    "invoiceId" TEXT NOT NULL,
    "clubShortName" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "facilityId" TEXT,
    "status" VARCHAR(20) NOT NULL,
    "issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueDate" TIMESTAMP(3),
    "subtotalInCents" INTEGER NOT NULL,
    "taxTotalInCents" INTEGER NOT NULL DEFAULT 0,
    "totalInCents" INTEGER NOT NULL,
    "amountPaidInCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("invoiceId")
);

-- CreateTable
CREATE TABLE "InvoiceLineItem" (
    "lineItemId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "productId" TEXT,
    "packagePlanId" TEXT,
    "memberPackageId" TEXT,
    "description" VARCHAR(500) NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceInCents" INTEGER NOT NULL,
    "discountInCents" INTEGER NOT NULL DEFAULT 0,
    "taxRateBps" INTEGER NOT NULL DEFAULT 0,
    "taxAmountInCents" INTEGER NOT NULL DEFAULT 0,
    "totalInCents" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceLineItem_pkey" PRIMARY KEY ("lineItemId")
);

-- CreateTable
CREATE TABLE "InvoicePayment" (
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountInCents" INTEGER NOT NULL,
    "paymentMethod" VARCHAR(30) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'succeeded',
    "processor" VARCHAR(30),
    "processorTransactionId" VARCHAR(255),
    "processorChargeId" VARCHAR(255),
    "processorFeeInCents" INTEGER,
    "reference" VARCHAR(255),
    "notes" TEXT,
    "receivedBy" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoicePayment_pkey" PRIMARY KEY ("paymentId")
);

-- CreateTable
CREATE TABLE "InvoiceRefund" (
    "refundId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amountInCents" INTEGER NOT NULL,
    "reason" VARCHAR(500),
    "refundedBy" TEXT NOT NULL,
    "refundedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processor" VARCHAR(30),
    "processorRefundId" VARCHAR(255),
    "processorFeeInCents" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceRefund_pkey" PRIMARY KEY ("refundId")
);

-- CreateIndex
CREATE INDEX "Invoice_clubShortName_idx" ON "Invoice"("clubShortName");

-- CreateIndex
CREATE INDEX "Invoice_userId_idx" ON "Invoice"("userId");

-- CreateIndex
CREATE INDEX "Invoice_clubShortName_userId_idx" ON "Invoice"("clubShortName", "userId");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_facilityId_idx" ON "Invoice"("facilityId");

-- CreateIndex
CREATE INDEX "Invoice_createdBy_idx" ON "Invoice"("createdBy");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_clubShortName_invoiceNumber_key" ON "Invoice"("clubShortName", "invoiceNumber");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_invoiceId_idx" ON "InvoiceLineItem"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_productId_idx" ON "InvoiceLineItem"("productId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_packagePlanId_idx" ON "InvoiceLineItem"("packagePlanId");

-- CreateIndex
CREATE INDEX "InvoiceLineItem_memberPackageId_idx" ON "InvoiceLineItem"("memberPackageId");

-- CreateIndex
CREATE INDEX "InvoicePayment_invoiceId_idx" ON "InvoicePayment"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoicePayment_status_idx" ON "InvoicePayment"("status");

-- CreateIndex
CREATE INDEX "InvoicePayment_receivedBy_idx" ON "InvoicePayment"("receivedBy");

-- CreateIndex
CREATE UNIQUE INDEX "InvoicePayment_processor_processorTransactionId_key" ON "InvoicePayment"("processor", "processorTransactionId");

-- CreateIndex
CREATE INDEX "InvoiceRefund_paymentId_idx" ON "InvoiceRefund"("paymentId");

-- CreateIndex
CREATE INDEX "InvoiceRefund_invoiceId_idx" ON "InvoiceRefund"("invoiceId");

-- CreateIndex
CREATE INDEX "InvoiceRefund_refundedBy_idx" ON "InvoiceRefund"("refundedBy");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceRefund_processor_processorRefundId_key" ON "InvoiceRefund"("processor", "processorRefundId");

-- CreateIndex
CREATE INDEX "MemberPackage_invoiceId_idx" ON "MemberPackage"("invoiceId");

-- AddForeignKey
ALTER TABLE "MemberPackage" ADD CONSTRAINT "MemberPackage_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("invoiceId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clubShortName_fkey" FOREIGN KEY ("clubShortName") REFERENCES "Club"("clubShortName") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_facilityId_fkey" FOREIGN KEY ("facilityId") REFERENCES "ClubFacility"("facilityId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_createdBy_fkey" FOREIGN KEY ("createdBy") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("invoiceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("productId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_packagePlanId_fkey" FOREIGN KEY ("packagePlanId") REFERENCES "PackagePlan"("packagePlanId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLineItem" ADD CONSTRAINT "InvoiceLineItem_memberPackageId_fkey" FOREIGN KEY ("memberPackageId") REFERENCES "MemberPackage"("memberPackageId") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("invoiceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoicePayment" ADD CONSTRAINT "InvoicePayment_receivedBy_fkey" FOREIGN KEY ("receivedBy") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRefund" ADD CONSTRAINT "InvoiceRefund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "InvoicePayment"("paymentId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRefund" ADD CONSTRAINT "InvoiceRefund_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("invoiceId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceRefund" ADD CONSTRAINT "InvoiceRefund_refundedBy_fkey" FOREIGN KEY ("refundedBy") REFERENCES "User"("userId") ON DELETE RESTRICT ON UPDATE CASCADE;
