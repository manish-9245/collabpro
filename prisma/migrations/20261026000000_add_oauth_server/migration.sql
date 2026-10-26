-- CreateTable
CREATE TABLE "OAuthClient" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthCode" (
    "id" TEXT NOT NULL,
    "hashedCode" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OAuthToken" (
    "id" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "hashedAccess" TEXT NOT NULL,
    "hashedRefresh" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userEmail" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "accessExpiresAt" TIMESTAMP(3) NOT NULL,
    "refreshExpiresAt" TIMESTAMP(3) NOT NULL,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OAuthClient_clientId_key" ON "OAuthClient"("clientId");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthCode_hashedCode_key" ON "OAuthCode"("hashedCode");

-- CreateIndex
CREATE INDEX "OAuthCode_expiresAt_idx" ON "OAuthCode"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthToken_hashedAccess_key" ON "OAuthToken"("hashedAccess");

-- CreateIndex
CREATE UNIQUE INDEX "OAuthToken_hashedRefresh_key" ON "OAuthToken"("hashedRefresh");

-- CreateIndex
CREATE INDEX "OAuthToken_familyId_idx" ON "OAuthToken"("familyId");

-- CreateIndex
CREATE INDEX "OAuthToken_userEmail_idx" ON "OAuthToken"("userEmail");

-- CreateIndex
CREATE INDEX "OAuthToken_refreshExpiresAt_idx" ON "OAuthToken"("refreshExpiresAt");

-- AddForeignKey
ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthCode" ADD CONSTRAINT "OAuthCode_userEmail_fkey" FOREIGN KEY ("userEmail") REFERENCES "User"("email") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OAuthToken" ADD CONSTRAINT "OAuthToken_userEmail_fkey" FOREIGN KEY ("userEmail") REFERENCES "User"("email") ON DELETE CASCADE ON UPDATE CASCADE;
