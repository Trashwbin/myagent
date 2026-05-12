import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const testHome = join(tmpdir(), `myagent-test-home-${process.pid}`);
const originalMyAgentHome = process.env.MYAGENT_HOME;
mkdirSync(testHome, { recursive: true });

process.env.MYAGENT_HOME = testHome;

afterAll(() => {
  if (process.env.MYAGENT_HOME === testHome) {
    if (originalMyAgentHome === undefined) {
      delete process.env.MYAGENT_HOME;
    } else {
      process.env.MYAGENT_HOME = originalMyAgentHome;
    }
  }
  rmSync(testHome, { recursive: true, force: true });
});
