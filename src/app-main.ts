#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import {
  loadGlobalConfig,
  resolveApprovalMode,
  resolveModelProfile,
  resolveModelProfiles,
} from "./config/config.js";
import type { ModelProfile } from "./config/config.js";
import { createProviderFromProfile } from "./model/provider-factory.js";
import type { Provider } from "./model/provider.js";
import { openStore } from "./storage/store.js";
import { buildDefaultRegistry } from "./tools/default-registry.js";
import { createAppServer, findAvailablePort } from "./app/server.js";

function canonicalPath(input: string): string {
  const resolved = resolve(input);
  return existsSync(resolved) ? realpathSync.native(resolved) : resolved;
}

function createAppBootstrapProvider(): Provider {
  return {
    name: "app-bootstrap",
    async *stream() {
      throw new Error(
        "No model configured. Add `model` or `provider.<name>.models` to your myAgent config.",
      );
    },
  };
}

function createProviderForProfile(profile: ModelProfile): Provider {
  return createProviderFromProfile(profile);
}

async function main(): Promise<void> {
  const fallbackProjectPath = canonicalPath(process.cwd());
  const config = loadGlobalConfig();
  const modelProfiles = resolveModelProfiles(config);
  const activeProfile = resolveModelProfile(config);
  const provider = createAppBootstrapProvider();
  const store = openStore();
  store.upsertProject({ path: fallbackProjectPath });

  const port = await findAvailablePort(43110);
  const server = createAppServer({
    provider,
    providerName: activeProfile?.provider ?? "openai",
    modelName: activeProfile?.model,
    modelProfileId: activeProfile?.id,
    modelProfiles,
    createProvider: createProviderForProfile,
    registry: buildDefaultRegistry(),
    approval: resolveApprovalMode(config),
    store,
    cwd: fallbackProjectPath,
  });

  server.listen(port, "127.0.0.1", () => {
    console.log(`myAgent app listening on http://127.0.0.1:${port}`);
  });
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
