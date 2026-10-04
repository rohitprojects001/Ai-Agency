import { AutomationTrigger, LeadStatus } from "@prisma/client";
import { z } from "zod";

export const automationConditionSchema = z.object({
  field: z.string().trim().min(1).max(80),
  operator: z.enum(["equals", "contains"]),
  value: z.string().max(300),
});

export const automationActionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SEND_MESSAGE"),
    channel: z.enum(["WHATSAPP", "SMS", "EMAIL"]),
    content: z.string().trim().min(1).max(4000),
    subject: z.string().max(200).optional(),
  }),
  z.object({
    type: z.literal("SET_LEAD_STATUS"),
    status: z.nativeEnum(LeadStatus),
  }),
]);

export const automationWorkflowSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().max(500).optional(),
  trigger: z.nativeEnum(AutomationTrigger),
  isActive: z.boolean().optional(),
  conditions: z.array(automationConditionSchema).max(12).optional(),
  actions: z.array(automationActionSchema).min(1).max(20),
});

export type AutomationAction = z.infer<typeof automationActionSchema>;
export type AutomationCondition = z.infer<typeof automationConditionSchema>;
export type AutomationWorkflowInput = z.infer<typeof automationWorkflowSchema>;