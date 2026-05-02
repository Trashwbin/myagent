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
    requiredTools: ["Read"],
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
    requiredTools: ["Read", "apply_patch"],
    mustContainToolErrors: ["Patch validation failed before execution"],
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
    requiredTools: ["Read"],
    maxTurns: 5,
  },
};

const MULTI_FILE_PATCH_HAPPY: ScenarioDefinition = {
  name: "multi-file-patch-happy",
  description:
    "Perform a realistic multi-file patch workflow using glob/Read/apply_patch without falling back to bash.",
  prompt:
    "Use glob to find the project files you need, Read the relevant ones, then use a single apply_patch call to make all requested changes. Update README.md by adding a bullet under ## Notes that says `- The workspace should support multi-file patch updates.`. Move patch-create-test.txt to notes/patch-create-archived.txt and change its first line to `This file was archived by apply_patch.`. Create reports/summary.txt with exactly three lines: `workspace test summary`, `multi-file patch exercised`, `created by agent`. Delete apply-patch-created.txt. Verify the result when done. Do not use bash.",
  setup: {
    files: {
      "README.md": `# myagent test workspace\n\n## Notes\n\n- The agent should be able to read this file.\n- The agent should be able to search for \`workspace\`.\n`,
      "patch-create-test.txt": `This file was created by apply_patch.\nTest line 1\nTest line 2\n`,
      "apply-patch-created.txt": `Created by apply_patch in test6.\nThis tests multi-file atomic operations.\n`,
    },
  },
  expect: {
    success: true,
    requiredTools: ["glob", "Read", "apply_patch"],
    forbiddenTools: ["bash"],
    mustReadFiles: ["README.md", "patch-create-test.txt"],
    mustMutateFiles: [
      "README.md",
      "patch-create-test.txt",
      "notes/patch-create-archived.txt",
      "reports/summary.txt",
      "apply-patch-created.txt",
    ],
    maxTurns: 6,
  },
};

const EXTERNAL_DIRECTORY_APPROVAL: ScenarioDefinition = {
  name: "external-directory-approval",
  description:
    "Read a file from a sibling external project and verify approval flow plus boundary discovery.",
  prompt:
    "Starting from ../external/src/session/loop.ts, use find_up to locate the nearest package.json. Then Read that package.json and tell me the package name. Do not use bash.",
  setup: {
    files: {
      "README.md": `workspace root\n`,
    },
    externalFiles: {
      "package.json": `{\n  "name": "external-lib",\n  "version": "1.0.0"\n}\n`,
      "src/session/loop.ts": `export const loop = true;\n`,
    },
  },
  expect: {
    success: true,
    requiredTools: ["find_up", "Read"],
    forbiddenTools: ["bash"],
    requiredApprovalTools: ["find_up"],
    mustReadFiles: ["package.json"],
    maxTurns: 4,
  },
};

export const ALL_SCENARIOS: Record<string, ScenarioDefinition> = {
  "file-mutation-happy": FILE_MUTATION_HAPPY,
  "patch-recover": PATCH_RECOVER,
  "sensitive-path": SENSITIVE_PATH,
  "multi-file-patch-happy": MULTI_FILE_PATCH_HAPPY,
  "external-directory-approval": EXTERNAL_DIRECTORY_APPROVAL,
};

export function listScenarios(): string[] {
  return Object.keys(ALL_SCENARIOS);
}

export function getScenario(name: string): ScenarioDefinition | undefined {
  return ALL_SCENARIOS[name];
}
