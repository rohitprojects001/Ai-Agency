/*
  Warnings:

  - A unique constraint covering the columns `[twilioPhoneNumber]` on the table `business_profiles` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_twilioPhoneNumber_key" ON "business_profiles"("twilioPhoneNumber");
