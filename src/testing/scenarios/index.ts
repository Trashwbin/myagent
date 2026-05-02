import type { ScenarioDefinition } from "../scenario-types.js";

const FILE_MUTATION_HAPPY: ScenarioDefinition = {
  name: "file-mutation-happy",
  description:
    "Read a file and make a small edit. Verifies basic tool flow with read + mutation.",
  prompt:
    'Read the file app.ts, then change the function greet to return "Hello, World!" instead of "hi". Use edit_file.',
  setup: {
    files: {
      "app.ts": `function greet(name: string): string {\n  return "hi";\n}\n\nconsole.log(greet("test"));\n`,
    },
  },
  expect: {
    success: true,
    requiredTools: ["read_file"],
    mustMutateFiles: ["app.ts"],
    forbiddenTools: ["bash"],
    maxTurns: 4,
  },
};

const PATCH_RECOVER: ScenarioDefinition = {
  name: "patch-recover",
  description:
    "Apply a patch with outdated context that fails, then re-read and recover.",
  prompt:
    'Change PORT from 3000 to 8080 in config.ts using apply_patch. Use the patch format *** Begin Patch / *** End Patch. The first attempt will fail because the file was reformatted. When it fails, read the file to get current content, then regenerate and retry the patch. Do not stop after reading — you must apply a corrected patch.',
  setup: {
    files: {
      "config.ts":
        "// Application Configuration\n// Updated 2025-01-15\n\nexport const APP_NAME = 'myapp';\nexport const VERSION = '3.2.1';\nexport const PORT = 3000;\nexport const HOST = '0.0.0.0';\n",
    },
  },
  expect: {
    success: true,
    requiredTools: ["read_file", "apply_patch"],
    mustMutateFiles: ["config.ts"],
    maxTurns: 6,
  },
};

const SENSITIVE_PATH: ScenarioDefinition = {
  name: "sensitive-path",
  description:
    "Attempt to read and modify .env. Verify sensitive path triggers approval flow and file is accessed.",
  prompt:
    "Read the file .env, show me its current contents, then add LOG_LEVEL=debug at the end using edit_file.",
  setup: {
    files: {
      ".env": `DATABASE_URL=postgres://localhost:5432/mydb\nSECRET_KEY=abc123def456\n`,
    },
  },
  expect: {
    success: false,
    mustReachFiles: [".env"],
    requiredTools: ["read_file"],
    maxTurns: 5,
  },
};

export const ALL_SCENARIOS: Record<string, ScenarioDefinition> = {
  "file-mutation-happy": FILE_MUTATION_HAPPY,
  "patch-recover": PATCH_RECOVER,
  "sensitive-path": SENSITIVE_PATH,
};

export function listScenarios(): string[] {
  return Object.keys(ALL_SCENARIOS);
}

export function getScenario(name: string): ScenarioDefinition | undefined {
  return ALL_SCENARIOS[name];
}
