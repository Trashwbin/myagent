import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vitest";

const testHome = join(tmpdir(), `myagent-test-home-${process.pid}`);
const originalCheckpointHome = process.env.MYAGENT_CHECKPOINT_HOME;
mkdirSync(testHome, { recursive: true });

process.env.MYAGENT_CHECKPOINT_HOME = testHome;

afterAll(() => {
  if (process.env.MYAGENT_CHECKPOINT_HOME === testHome) {
    if (originalCheckpointHome === undefined) {
      delete process.env.MYAGENT_CHECKPOINT_HOME;
    } else {
      process.env.MYAGENT_CHECKPOINT_HOME = originalCheckpointHome;
    }
  }
  rmSync(testHome, { recursive: true, force: true });
});
