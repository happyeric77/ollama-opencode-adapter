/**
 * PoC: Intent Extraction 測試 (使用 OpenCode SDK + gpt-4o)
 *
 * 測試目標：
 * - 使用 gpt-4o 從用戶語音指令中提取 Intent
 * - 輸出結構化 JSON 格式
 *
 * 使用方式：npm run test-opencode-intent
 */

import { createOpencode } from "@opencode-ai/sdk";

const INTENT_EXTRACTION_PROMPT = `You are a smart home intent extractor.

RESPOND WITH VALID JSON ONLY. No markdown, no explanation, no code blocks.

Schema:
{
  "intent": "turn_on | turn_off | unknown",
  "domain": "light | switch | climate | media_player",
  "entity": "entity_id or descriptive name",
  "confidence": 0.0 - 1.0
}

If you cannot determine the intent, use:
{"intent": "unknown", "confidence": 0.0}`;

interface Intent {
  intent: string;
  domain?: string;
  entity?: string;
  confidence: number;
}

interface TestCase {
  input: string;
  expectedIntent: string;
  expectedDomain?: string;
}

const TEST_CASES: TestCase[] = [
  { input: "Turn on the living room light", expectedIntent: "turn_on", expectedDomain: "light" },
  { input: "關掉客廳的燈", expectedIntent: "turn_off", expectedDomain: "light" },
  { input: "打開臥室的電燈", expectedIntent: "turn_on", expectedDomain: "light" },
  { input: "Turn off kitchen lights", expectedIntent: "turn_off", expectedDomain: "light" },
  { input: "What's the weather today?", expectedIntent: "unknown" },
];

async function extractIntent(
  client: any,
  sessionId: string,
  userMessage: string
): Promise<Intent | null> {
  // 發送 system prompt + user message
  await client.session.prompt({
    path: { id: sessionId },
    body: {
      model: { providerID: "github-copilot", modelID: "gpt-4o" },
      system: INTENT_EXTRACTION_PROMPT,
      parts: [{ type: "text", text: userMessage }],
    },
  });

  // 等待 assistant 回應
  const maxWait = 30000;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const messages = await client.session.messages({ path: { id: sessionId } });
    const assistantMsgs = messages.data?.filter((m: any) => m.info?.role === "assistant") || [];
    
    // 取最後一個 assistant 訊息
    const lastAssistant = assistantMsgs[assistantMsgs.length - 1];
    
    if (lastAssistant?.parts?.length > 0) {
      const textPart = lastAssistant.parts.find((p: any) => p.type === "text");
      if (textPart?.text) {
        try {
          // 嘗試解析 JSON
          const text = textPart.text.trim();
          // 移除可能的 markdown code block
          const jsonStr = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
          return JSON.parse(jsonStr) as Intent;
        } catch (e) {
          console.log(`   JSON parse error: ${textPart.text}`);
          return null;
        }
      }
    }

    await new Promise((r) => setTimeout(r, 500));
  }

  return null;
}

async function main() {
  console.log("=== Intent Extraction PoC (OpenCode SDK + gpt-4o) ===\n");

  const opencode = await createOpencode({
    hostname: "127.0.0.1",
    port: 7285,
    timeout: 30000,
  });

  const client = opencode.client;

  console.log(`Provider: github-copilot`);
  console.log(`Model: gpt-4o`);
  console.log(`Test cases: ${TEST_CASES.length}\n`);

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < TEST_CASES.length; i++) {
    const testCase = TEST_CASES[i];
    console.log(`\n--- Test ${i + 1}/${TEST_CASES.length} ---`);
    console.log(`Input: "${testCase.input}"`);

    // 為每個測試建立新 session（避免上下文干擾）
    const session = await client.session.create({
      body: { title: `intent-test-${i + 1}` },
    });
    const sessionId = session.data?.id!;

    const startTime = Date.now();
    const result = await extractIntent(client, sessionId, testCase.input);
    const elapsed = Date.now() - startTime;

    if (result) {
      console.log(`Output: ${JSON.stringify(result)}`);
      console.log(`Time: ${elapsed}ms`);

      const intentMatch = result.intent === testCase.expectedIntent;
      const domainMatch = !testCase.expectedDomain || result.domain === testCase.expectedDomain;

      if (intentMatch && domainMatch) {
        console.log(`Result: ✓ PASS`);
        passed++;
      } else {
        console.log(`Result: ✗ FAIL`);
        console.log(`  Expected intent: ${testCase.expectedIntent}, got: ${result.intent}`);
        if (testCase.expectedDomain) {
          console.log(`  Expected domain: ${testCase.expectedDomain}, got: ${result.domain}`);
        }
        failed++;
      }
    } else {
      console.log(`Output: null (timeout or parse error)`);
      console.log(`Result: ✗ FAIL`);
      failed++;
    }

    // 清理 session
    await client.session.delete({ path: { id: sessionId } });
  }

  console.log("\n\n=== 測試結果 ===");
  console.log(`Total: ${TEST_CASES.length}`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Success rate: ${((passed / TEST_CASES.length) * 100).toFixed(1)}%`);

  opencode.server.close();

  // Exit code based on test results
  if (failed > 0) {
    console.log("\n結論: Intent Extraction 部分成功，需要進一步優化 prompt");
    process.exit(1);
  } else {
    console.log("\n結論: Intent Extraction 完全可行！");
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
