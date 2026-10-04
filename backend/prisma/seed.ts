import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { defaultTrialPeriod } from "../src/services/organization-runtime";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("demo12345", 12);

  const user = await prisma.user.upsert({
    where: { email: "owner@urbanfit.demo" },
    update: { emailVerifiedAt: new Date(), status: "ACTIVE" },
    create: { name: "Demo Owner", email: "owner@urbanfit.demo", passwordHash, emailVerifiedAt: new Date() },
  });

  const org = await prisma.organization.upsert({
    where: { slug: "urbanfit-studio" },
    update: {},
    create: { name: "UrbanFit Studio", slug: "urbanfit-studio", ...defaultTrialPeriod() },
  });

  await prisma.organizationMember.upsert({
    where: { organizationId_userId: { organizationId: org.id, userId: user.id } },
    update: {},
    create: { organizationId: org.id, userId: user.id, role: "OWNER" },
  });

  await prisma.businessProfile.upsert({
    where: { organizationId: org.id },
    update: {},
    create: {
      organizationId: org.id,
      businessName: "UrbanFit Studio",
      category: "Fitness & Wellness",
      phone: "+91 98765 43210",
      email: "hello@urbanfit.demo",
      address: "Model Town, Ludhiana, Punjab",
      timezone: "Asia/Kolkata",
      aiInstructions: `Services and prices:
- Personal Training: ₹1,500 per session
- Gym Membership: ₹2,000/month
- Nutrition Consultation: ₹1,000

Business hours: Mon-Sat, 6 AM - 9 PM. Closed Sundays.
Location: Model Town, Ludhiana, Punjab.

Policy: Sessions can be rescheduled with 4 hours notice, no charge. Late cancellations are charged 50%.`,
    },
  });

  const contact = await prisma.contact.create({
    data: {
      organizationId: org.id,
      name: "Rahul Mehta",
      phone: "+91 90000 11111",
      email: "rahul@example.com",
      tags: ["gym", "high-intent"],
    },
  });

  const lead = await prisma.lead.create({
    data: {
      organizationId: org.id,
      contactId: contact.id,
      status: "QUALIFIED",
      source: "whatsapp",
      score: 84,
      scoreReasons: [
        { label: "Strong purchase intent", points: 25 },
        { label: "Requested pricing", points: 20 },
        { label: "Requested appointment", points: 15 },
        { label: "Repeated engagement", points: 10 },
      ],
      value: 2000,
    },
  });

  const conversation = await prisma.conversation.create({
    data: {
      organizationId: org.id,
      contactId: contact.id,
      channel: "WHATSAPP",
      status: "OPEN",
      aiSummary: "Customer wants personal training. Asked for pricing and tomorrow 5 PM slot.",
    },
  });

  await prisma.message.createMany({
    data: [
      {
        conversationId: conversation.id,
        sender: "CUSTOMER",
        content: "Hi, I want to know the price of personal training.",
      },
      {
        conversationId: conversation.id,
        sender: "AI",
        content: "Personal Training is ₹1,500 per session. Would you like to book a slot?",
      },
      {
        conversationId: conversation.id,
        sender: "CUSTOMER",
        content: "Can I book tomorrow at 5?",
      },
    ],
  });

  console.log("Seed complete:");
  console.log(`  Login: owner@urbanfit.demo / demo12345`);
  console.log(`  Organization: ${org.name} (${org.slug})`);
  console.log(`  Lead score demo: ${lead.score}/100`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
