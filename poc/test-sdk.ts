/**
 * PoC: Test basic @github/copilot-sdk connection
 */
import { CopilotClient } from "@github/copilot-sdk";

async function main() {
  console.log("🚀 Starting Copilot SDK test...\n");

  const client = new CopilotClient();

  try {
    console.log("📡 Creating session...");
    const session = await client.createSession({
      model: "claude-sonnet-4",
    });

    console.log("✅ Session created successfully!\n");

    console.log("💬 Sending test message...");
    const response = await session.sendAndWait({
      prompt: "What is 2 + 2? Reply with just the number.",
    });

    console.log("📨 Response received:");
    console.log(response?.data?.content || "No content");
    console.log("\n✅ SDK test completed successfully!");
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  } finally {
    await client.stop();
    process.exit(0);
  }
}

main();
