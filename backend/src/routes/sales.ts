import { Router } from "express";
import rateLimit from "express-rate-limit";
import { Resend } from "resend";
import { z } from "zod";
import { asyncHandler } from "../lib/async-handler";

export const salesRouter = Router();

const requestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many plan requests. Please try again later." },
});

const planDetails = {
  monthly: { name: "1 month", price: 99 },
  halfYear: { name: "6 months", price: 199 },
  sevenMonths: { name: "7 months", price: 299 },
} as const;

const accessRequestSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  businessName: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(30).optional().default(""),
  plan: z.enum(["monthly", "halfYear", "sevenMonths"]),
});

salesRouter.post("/requests", requestLimiter, asyncHandler(async (req, res) => {
  const parsed = accessRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Please check your details and selected plan." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = process.env.SALES_NOTIFICATION_EMAIL;
  if (!apiKey || !from || !to) {
    return res.status(503).json({ error: "Plan requests are temporarily unavailable. Please try again later." });
  }

  const { name, email, businessName, phone, plan } = parsed.data;
  const selectedPlan = planDetails[plan];
  const resend = new Resend(apiKey);
  const result = await resend.emails.send({
    from,
    to,
    replyTo: email,
    subject: `New ${selectedPlan.name} workshop access request`,
    text: [
      "A new Business AI Workshop plan request was submitted.",
      "",
      `Name: ${name}`,
      `Business: ${businessName}`,
      `Email: ${email}`,
      `Phone: ${phone || "Not provided"}`,
      `Plan: ${selectedPlan.name} — ₹${selectedPlan.price}`,
      "",
      "Contact this person to arrange payment and manually activate their workshop access.",
    ].join("\n"),
  });

  if (result.error) {
    console.error("Failed to send workshop access request notification:", result.error);
    if (/domain is not verified|verify a domain|testing emails to your own email/i.test(result.error.message)) {
      return res.status(503).json({
        error: "Email notifications aren't ready yet. Verify a sending domain in Resend and set RESEND_FROM_EMAIL to an address on that domain.",
      });
    }
    return res.status(502).json({ error: "We could not send your request right now. Please try again shortly." });
  }

  return res.status(201).json({ message: "Request received. We’ll contact you about activating your access." });
}));
