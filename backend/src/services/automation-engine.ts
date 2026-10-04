import { AutomationTrigger, Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { automationActionSchema, automationConditionSchema, type AutomationAction, type AutomationCondition } from "../lib/automation-schema";
import { sendOutboundMessage } from "./outbound-messages";

type AutomationEvent = {
  organizationId: string;
  trigger: AutomationTrigger;
  contactId?: string;
  payload: Record<string, unknown>;
};

function getValue(source: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Record<string, unknown>)[key];
  }, source);
}

function matchesConditions(conditions: unknown, payload: Record<string, unknown>): boolean {
  if (!Array.isArray(conditions)) return true;
  const parsed = automationConditionSchema.array().safeParse(conditions);
  if (!parsed.success) return false;
  return parsed.data.every((condition: AutomationCondition) => {
    const actual = getValue(payload, condition.field);
    if (actual === undefined || actual === null) return false;
    const value = String(actual).toLowerCase();
    const expected = condition.value.toLowerCase();
    return condition.operator === "equals" ? value === expected : value.includes(expected);
  });
}

function renderTemplate(template: string, payload: Record<string, unknown>): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path: string) => {
    const value = getValue(payload, path);
    return value === undefined || value === null ? "" : String(value);
  });
}

async function executeAction(action: AutomationAction, event: AutomationEvent): Promise<Record<string, unknown>> {
  if (action.type === "SEND_MESSAGE") {
    if (!event.contactId) throw new Error("This workflow needs an associated contact to send a message");
    const result = await sendOutboundMessage({
      organizationId: event.organizationId,
      contactId: event.contactId,
      channel: action.channel,
      content: renderTemplate(action.content, event.payload),
      subject: action.subject ? renderTemplate(action.subject, event.payload) : undefined,
      sender: "AI",
    });
    return { action: action.type, channel: action.channel, messageId: result.message.id, deliveryStatus: result.message.deliveryStatus };
  }

  if (!event.contactId) throw new Error("This workflow needs an associated contact to update a lead");
  const lead = await prisma.lead.findFirst({ where: { organizationId: event.organizationId, contactId: event.contactId } });
  if (!lead) throw new Error("No lead exists for the workflow contact");
  const updated = await prisma.lead.update({ where: { id: lead.id }, data: { status: action.status } });
  return { action: action.type, leadId: updated.id, status: updated.status };
}

export async function runAutomationEvent(event: AutomationEvent): Promise<void> {
  const workflows = await prisma.automationWorkflow.findMany({
    where: { organizationId: event.organizationId, trigger: event.trigger, isActive: true },
    orderBy: { createdAt: "asc" },
  });

  for (const workflow of workflows) {
    if (!matchesConditions(workflow.conditions, event.payload)) continue;
    const parsedActions = automationActionSchema.array().safeParse(workflow.actions);
    if (!parsedActions.success) {
      await prisma.automationRun.create({
        data: {
          organizationId: event.organizationId,
          workflowId: workflow.id,
          trigger: event.trigger,
          status: "FAILED",
          input: event.payload as Prisma.InputJsonValue,
          error: "Workflow contains invalid action definitions",
          completedAt: new Date(),
        },
      });
      continue;
    }

    const output: Record<string, unknown>[] = [];
    let error: string | null = null;
    for (const action of parsedActions.data) {
      try {
        output.push(await executeAction(action, event));
      } catch (actionError) {
        error = actionError instanceof Error ? actionError.message : "Workflow action failed";
        break;
      }
    }

    await prisma.automationRun.create({
      data: {
        organizationId: event.organizationId,
        workflowId: workflow.id,
        trigger: event.trigger,
        status: error ? "FAILED" : "SUCCEEDED",
        input: event.payload as Prisma.InputJsonValue,
        output: output as Prisma.InputJsonValue,
        error,
        completedAt: new Date(),
      },
    });
  }
}