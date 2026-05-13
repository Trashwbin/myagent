#!/usr/bin/env npx tsx
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";
import {
  loadConfig,
  resolveModelName,
  resolveProviderConfig,
  resolveProviderName,
} from "../src/config/config.js";

import { listScenarios, getScenario } from "../src/testing/scenarios/index.js";
import { runScenario, formatResult } from "../src/testing/scenario-runner.js";
import type { LiveScenarioConfig } from "../src/testing/scenario-types.js";

function printUsage(): never {
  console.log(`Usage: pnpm live:scenario --scenario <name> [options]

Options:
  --scenario <name>      Scenario to run (required)
  --output-dir <dir>     Transcript output directory (default: .live-scenarios/)
  --list                 List available scenarios
  --all                  Run all scenarios

Configuration:
  Runtime provider, model, API keys, base URL, and turn limits come from
  .myagent/config.json / config.local.json.
`);
  process.exit(0);
}

const cliOptions = {
  scenario: { type: "string" },
  "output-dir": { type: "string" },
  list: { type: "boolean" },
  all: { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

export function normalizeCliArgv(argv: string[]): string[] {
  if (argv[0] === "--") return argv.slice(1);
  return argv;
}

export function parseCliValues(argv: string[]) {
  return parseArgs({
    args: normalizeCliArgv(argv),
    options: cliOptions,
    strict: true,
  }).values;
}

function resolveConfig(values: ReturnType<typeof parseCliValues>): LiveScenarioConfig {
  const config = loadConfig({ workspaceRoot: process.cwd() });
  const provider = resolveProviderName(config);
  const providerConfig = resolveProviderConfig(config, provider);
  const model = resolveModelName(config, provider);

  if (!providerConfig.apiKey && !providerConfig.authToken) {
    console.error(
      "Error: live scenarios require apiKey or authToken in .myagent/config.json or config.local.json.",
    );
    process.exit(1);
  }

  return {
    provider,
    model,
    baseUrl: providerConfig.baseUrl,
    apiKey: providerConfig.apiKey,
    authToken: providerConfig.authToken,
    mode: providerConfig.mode,
    cwd: process.cwd(),
    maxTurns: config.maxTurns,
    maxOutputTokens: providerConfig.maxOutputTokens,
    autoApprove: true,
    outputDir: values["output-dir"] ?? undefined,
  };
}

async function main(): Promise<void> {
  const values = parseCliValues(process.argv.slice(2));

  if (values.help) {
    printUsage();
  }

  if (values.list) {
    console.log("Available scenarios:");
    for (const name of listScenarios()) {
      const s = getScenario(name)!;
      console.log(`  ${name}: ${s.description}`);
    }
    process.exit(0);
  }

  const config = resolveConfig(values);

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

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
