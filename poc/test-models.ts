/**
 * PoC: Check available models and test gpt-5
 */
import { CopilotClient } from "@github/copilot-sdk";

const SYSTEM_PROMPT = `You are a smart home intent extractor.

RESPOND WITH VALID JSON ONLY. No markdown, no explanation, no code fences.

Schema:
{
  "intent": "turn_on | turn_off | unknown",
  "domain": "light | switch | climate | media_player",
  "entity": "entity_id or descriptive name",
  "confidence": 0.0 - 1.0
}`;

const TEST_CASES = [
  "Turn on the living room light",
  "關掉客廳的燈",
];

async function testModel(modelName: string) {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🤖 Testing model: ${modelName}`);
  console.log("=".repeat(60));

  const client = new CopilotClient();

  try {
    const startTime = Date.now();
    const session = await client.createSession({
      model: modelName,
      systemMessage: {
        content: SYSTEM_PROMPT,
      },
    });

    for (const testCase of TEST_CASES) {
      const reqStart = Date.now();
      console.log(`\n📝 Input: "${testCase}"`);

      const response = await session.sendAndWait({
        prompt: testCase,
      });

      const latency = Date.now() - reqStart;
      const content = response?.data?.content || "";
      console.log(`📨 Output: ${content}`);
      console.log(`⏱️  Latency: ${latency}ms`);

      // Validate JSON
      try {
        JSON.parse(content);
        console.log(`✅ Valid JSON`);
      } catch {
        console.log(`❌ Invalid JSON`);
      }
    }

    await client.stop();
  } catch (error) {
    console.error(`❌ Error with ${modelName}:`, error);
  }
}

async function main() {
  console.log("🔍 Testing available models for Intent Extraction...\n");

  // Test gpt-5 (available according to CLI help)
  await testModel("gpt-5");

  // Also test gpt-4.1 to see if it works
  await testModel("gpt-4.1");

  console.log("\n\n✅ Model comparison complete!");
  process.exit(0);
}

main();
