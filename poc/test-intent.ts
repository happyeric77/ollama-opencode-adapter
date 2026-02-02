/**
 * PoC: Test Intent Extraction with system prompt
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
}

If you cannot determine the intent, use:
{"intent": "unknown", "confidence": 0.0}`;

const TEST_CASES = [
  "Turn on the living room light",
  "關掉客廳的燈",
  "打開臥室的冷氣",
  "What's the weather today?",
  "把電視關掉",
];

async function main() {
  console.log("🚀 Starting Intent Extraction test...\n");

  const client = new CopilotClient();

  try {
    const session = await client.createSession({
      model: "claude-sonnet-4",
      systemMessage: {
        content: SYSTEM_PROMPT,
      },
    });

    console.log("✅ Session created with system prompt\n");
    console.log("=".repeat(60));

    for (const testCase of TEST_CASES) {
      console.log(`\n📝 Input: "${testCase}"`);

      const response = await session.sendAndWait({
        prompt: testCase,
      });

      const content = response?.data?.content || "";
      console.log(`📨 Raw output: ${content}`);

      // Try to parse as JSON
      try {
        const parsed = JSON.parse(content);
        console.log(`✅ Valid JSON:`, parsed);
      } catch {
        console.log(`⚠️  Not valid JSON, attempting extraction...`);
        // Try to extract JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            console.log(`✅ Extracted JSON:`, parsed);
          } catch {
            console.log(`❌ Failed to parse extracted JSON`);
          }
        } else {
          console.log(`❌ No JSON found in response`);
        }
      }

      console.log("-".repeat(60));
    }

    console.log("\n✅ Intent Extraction test completed!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await client.stop();
    process.exit(0);
  }
}

main();
