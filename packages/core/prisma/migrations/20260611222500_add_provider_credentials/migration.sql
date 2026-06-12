CREATE TABLE "ProviderCredential" (
    "provider" TEXT NOT NULL,
    "credentialsEnc" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProviderCredential_pkey" PRIMARY KEY ("provider")
);
