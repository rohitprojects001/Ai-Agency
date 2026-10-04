import OpenAI from "openai";
import type { OrganizationMode } from "@prisma/client";

let client: OpenAI | null = null;

// Lazy-init so the server doesn't crash on boot if the key isn't set yet -
// it only errors when someone actually tries to use the AI.
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set. Add it to backend/.env");
    }
    client = new OpenAI({ apiKey });
  }
  return client;
}

export type ChatMessage = OpenAI.Chat.ChatCompletionMessageParam;
export type ChatTool = OpenAI.Chat.ChatCompletionTool;
export type ToolCall = OpenAI.Chat.ChatCompletionMessageToolCall;

export class DemoAIProvider {
  async run(messages: ChatMessage[]): Promise<{ content: string; toolCalls: null }> {
    const lastMessage = [...messages].reverse().find((message) => message.role === "user");
    const prompt = typeof lastMessage?.content === "string" ? lastMessage.content.trim() : "";
    const excerpt = prompt ? ` You asked: “${prompt.slice(0, 180)}”.` : "";
    return {
      content: `This is a Trial Mode AI preview.${excerpt} Your workspace data and message flow are being tested locally; no paid AI or external communication provider was called.`,
      toolCalls: null,
    };
  }
}

export class RealAIProvider {
  async run(messages: ChatMessage[], tools?: ChatTool[]): Promise<{ content: string | null; toolCalls: ToolCall[] | null }> {
    const completion = await getClient().chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      tools,
      temperature: 0.3,
      max_tokens: 400,
    });

    const message = completion.choices[0]?.message;
    if (!message) throw new Error("AI returned an empty response");

    return {
      content: message.content,
      toolCalls: message.tool_calls && message.tool_calls.length > 0 ? message.tool_calls : null,
    };
  }
}

// Ask the model for the next step. Returns either plain text, or a list of
// tool calls the orchestrator should execute and feed back in. This is the
// building block for the AI actually DOING things (booking an appointment,
// creating a lead) instead of just talking about them.
export async function runChatTurn(
  messages: ChatMessage[],
  tools?: ChatTool[],
  mode: OrganizationMode = "LIVE"
): Promise<{ content: string | null; toolCalls: ToolCall[] | null }> {
  if (mode === "TRIAL") return new DemoAIProvider().run(messages);
  return new RealAIProvider().run(messages, tools);
}
