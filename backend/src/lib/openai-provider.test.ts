import assert from "node:assert/strict";
import { test } from "node:test";
import { runChatTurn } from "./openai";

test("Trial AI uses a local demo response without an OpenAI key", async () => {
  const originalKey = process.env.OPENAI_API_KEY;
  try {
    delete process.env.OPENAI_API_KEY;
    const result = await runChatTurn([{ role: "user", content: "Can I book?" }], undefined, "TRIAL");
    assert.equal(result.toolCalls, null);
    assert.match(result.content ?? "", /Trial Mode AI preview/);
    assert.match(result.content ?? "", /no paid AI or external communication provider was called/);
  } finally {
    if (originalKey === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalKey;
  }
});
