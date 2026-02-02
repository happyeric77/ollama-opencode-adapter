/**
 * PoC: OpenCode SDK 基本連線測試
 *
 * 測試目標：
 * 1. 使用 SDK 自動啟動 opencode server
 * 2. 列出可用 providers 和模型
 * 3. 確認 gpt-4o 可用
 * 4. 發送測試訊息
 *
 * 使用方式：npm run test-opencode
 */

import { createOpencode } from "@opencode-ai/sdk";

async function main() {
  console.log("=== OpenCode SDK PoC 測試 ===\n");

  // 1. 啟動 server
  console.log("[1] 啟動 OpenCode Server...");
  const opencode = await createOpencode({
    hostname: "127.0.0.1",
    port: 7275,
    timeout: 30000,
  });
  console.log(`   Server URL: ${opencode.server.url}`);

  const client = opencode.client;

  // 2. 取得 providers
  console.log("\n[2] 取得 Providers 與模型...");
  const providersResult = await client.config.providers();
  const providersData = providersResult.data;

  if (!providersData?.providers) {
    console.error("   Failed to get providers");
    opencode.server.close();
    return;
  }

  // 找 gpt-4o
  let gpt4oInfo: { providerId: string; modelId: string } | null = null;

  for (const [providerId, provider] of Object.entries(providersData.providers)) {
    const p = provider as any;
    console.log(`\n   Provider: ${providerId} (${p.name || "unnamed"})`);

    if (p.models) {
      const modelIds = Object.keys(p.models);
      console.log(`   Models (${modelIds.length}):`);

      for (const modelId of modelIds) {
        if (modelId.includes("gpt-4o") && !modelId.includes("mini") && !modelId.includes("audio")) {
          console.log(`     * ${modelId} (gpt-4o found!)`);
          if (!gpt4oInfo) {
            gpt4oInfo = { providerId, modelId };
          }
        }
      }

      // 顯示前 5 個模型
      const displayModels = modelIds.slice(0, 5);
      for (const modelId of displayModels) {
        if (!modelId.includes("gpt-4o")) {
          console.log(`     - ${modelId}`);
        }
      }
      if (modelIds.length > 5) {
        console.log(`     ... and ${modelIds.length - 5} more`);
      }
    }
  }

  // 3. gpt-4o 狀態
  console.log("\n[3] gpt-4o 模型狀態:");
  if (gpt4oInfo) {
    console.log(`   ✓ 找到 gpt-4o!`);
    console.log(`   Provider: ${gpt4oInfo.providerId}`);
    console.log(`   Model ID: ${gpt4oInfo.modelId}`);
  } else {
    console.log("   ✗ 未找到 gpt-4o");
  }

  // 4. 建立 Session 並發送訊息
  console.log("\n[4] 建立 Session...");
  const sessionResult = await client.session.create({
    body: { title: "PoC Test" },
  });

  const sessionId = sessionResult.data?.id;
  if (!sessionId) {
    console.error("   Failed to create session");
    opencode.server.close();
    return;
  }
  console.log(`   Session ID: ${sessionId}`);

  // 5. 發送測試訊息（使用預設模型）
  console.log("\n[5] 發送測試訊息 (預設模型)...");
  try {
    const promptResult = await client.session.prompt({
      path: { id: sessionId },
      body: {
        parts: [{ type: "text", text: 'Reply with exactly: "Hello from OpenCode!"' }],
      },
    });

    const response = promptResult.data;
    if (response?.parts) {
      for (const part of response.parts) {
        if (part.type === "text") {
          console.log(`   Response: ${part.text}`);
        }
      }
    }
  } catch (e: any) {
    console.error(`   Error: ${e.message}`);
  }

  // 6. 如果有 gpt-4o，用它發送訊息
  if (gpt4oInfo) {
    console.log(`\n[6] 使用 gpt-4o 發送訊息...`);
    try {
      const gpt4oResult = await client.session.prompt({
        path: { id: sessionId },
        body: {
          model: {
            providerID: gpt4oInfo.providerId,
            modelID: gpt4oInfo.modelId,
          },
          parts: [{ type: "text", text: 'Reply with exactly: "Hello from gpt-4o!"' }],
        },
      });

      const response = gpt4oResult.data;
      if (response?.parts) {
        for (const part of response.parts) {
          if (part.type === "text") {
            console.log(`   gpt-4o Response: ${part.text}`);
          }
        }
      }
    } catch (e: any) {
      console.error(`   Error using gpt-4o: ${e.message}`);
    }
  }

  // 7. 清理
  console.log("\n[7] 清理...");
  await client.session.delete({ path: { id: sessionId } });
  console.log("   Session deleted");

  opencode.server.close();
  console.log("   Server closed");

  console.log("\n=== PoC 測試完成 ===");
  console.log("\n結論:");
  console.log("  - OpenCode SDK: ✓ 可用");
  console.log(`  - gpt-4o: ${gpt4oInfo ? "✓ 可用" : "✗ 不可用"}`);
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
