#!/usr/bin/env npx tsx
import "dotenv/config";
import { parseArgs } from "node:util";

import { listScenarios, getScenario } from "../src/testing/scenarios/index.js";
import { runScenario, formatResult } from "../src/testing/scenario-runner.js";
import type { LiveScenarioConfig } from "../src/testing/scenario-types.js";

function printUsage(): never {
  console.log(`Usage: pnpm live:scenario --scenario <name> [options]

Options:
  --scenario <name>      Scenario to run (required)
  --provider <provider>  Provider: openai | anthropic (default: from MYAGENT_PROVIDER or openai)
  --model <model>        Model name (default: from MYAGENT_MODEL)
  --base-url <url>       API base URL (default: from MYAGENT_BASE_URL)
  --output-dir <dir>     Transcript output directory (default: .live-scenarios/)
  --max-turns <n>        Max agent turns (default: from scenario)
  --list                 List available scenarios
  --all                  Run all scenarios

Environment variables:
  MYAGENT_PROVIDER    Default provider
  MYAGENT_MODEL       Default model
  MYAGENT_BASE_URL    API base URL
  MYAGENT_API_KEY     API key (required for live runs)
  MYAGENT_AUTH_TOKEN  Auth token (anthropic)
`);
  process.exit(0);
}

const { values } = parseArgs({
  options: {
    scenario: { type: "string" },
    provider: { type: "string" },
    model: { type: "string" },
    "base-url": { type: "string" },
    "output-dir": { type: "string" },
    "max-turns": { type: "string" },
    list: { type: "boolean" },
    all: { type: "boolean" },
  },
  strict: true,
});

if (values.list) {
  console.log("Available scenarios:");
  for (const name of listScenarios()) {
    const s = getScenario(name)!;
    console.log(`  ${name}: ${s.description}`);
  }
  process.exit(0);
}

function resolveConfig(): LiveScenarioConfig {
  const provider = (values.provider ?? process.env.MYAGENT_PROVIDER ?? "openai") as
    | "openai"
    | "anthropic";

  const apiKey = process.env.MYAGENT_API_KEY;
  const authToken = process.env.MYAGENT_AUTH_TOKEN;

  if (!apiKey && !authToken) {
    console.error(
      "Error: MYAGENT_API_KEY (or MYAGENT_AUTH_TOKEN for anthropic) is required for live scenarios.\n" +
        "Set it in your environment or .env file.",
    );
    process.exit(1);
  }

  const model =
    values.model ?? process.env.MYAGENT_MODEL ?? (provider === "openai" ? "gpt-4o" : "claude-sonnet-4-5");

  return {
    provider,
    model,
    baseUrl: values["base-url"] ?? process.env.MYAGENT_BASE_URL,
    apiKey,
    authToken,
    cwd: process.cwd(),
    maxTurns: values["max-turns"] ? parseInt(values["max-turns"], 10) : undefined,
    autoApprove: true,
    outputDir: values["output-dir"] ?? undefined,
  };
}

async function main(): Promise<void> {
  const config = resolveConfig();

  const scenarioNames = values.all
    ? listScenarios()
    : values.scenario
      ? [values.scenario]
      : undefined;

  if (!scenarioNames) {
    printUsage();
  }

  const results: Array<{ name: string; passed: boolean; detail: string }> = [];
  let allPassed = true;

  for (const name of scenarioNames!) {
    const scenario = getScenario(name);
    if (!scenario) {
      console.error(`Unknown scenario: ${name}`);
      console.error(`Available: ${listScenarios().join(", ")}`);
      process.exit(1);
    }

    console.log(`\n--- Running: ${name} ---`);
    console.log(`Provider: ${config.provider} / ${config.model}`);

    try {
      const result = await runScenario(scenario, config);
      console.log(formatResult(result));
      results.push({ name, passed: result.passed, detail: "" });
      if (!result.passed) allPassed = false;
    } catch (err: any) {
      const detail = err.message ?? String(err);
      console.error(`Scenario "${name}" crashed: ${detail}`);
      results.push({ name, passed: false, detail });
      allPassed = false;
    }
  }

  console.log("\n--- Summary ---");
  for (const r of results) {
    console.log(`  ${r.passed ? "PASS" : "FAIL"} ${r.name}${r.detail ? `: ${r.detail}` : ""}`);
  }

  process.exit(allPassed ? 0 : 1);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
