import { loadProcessorConfig, processNextJob } from "./worker.js";

async function main() {
  const config = loadProcessorConfig(process.env);
  if (!config) {
    console.log("Processor idle: set PROCESSOR_SECRET and CLAUDE_CODE_OAUTH_TOKEN to enable it.");
    setInterval(() => {}, 60 * 60 * 1000);
    return;
  }

  console.log(
    `Processor started with model ${config.model}${config.clueTagModel ? `, ${config.clueTagModel} for Claim tagging` : ""}`,
  );
  for (;;) {
    let worked = false;
    try {
      worked = await processNextJob(config);
    } catch (err) {
      console.error("Processor poll failed:", err instanceof Error ? err.message : "unknown error");
    }
    if (!worked) await new Promise((r) => setTimeout(r, config.pollMs));
  }
}

process.on("SIGTERM", () => process.exit(0));
process.on("SIGINT", () => process.exit(0));
void main();
