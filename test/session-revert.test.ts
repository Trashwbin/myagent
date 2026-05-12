import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Message } from "../src/model/types.js";
import { createCheckpoint } from "../src/workspace/checkpoint.js";
import {
  findLastCheckpoint,
  formatRewindMessage,
  revertLast,
  rewindSession,
} from "../src/session/revert.js";

describe("session revert", () => {
  it("formats restored and deleted files consistently", () => {
    expect(
      formatRewindMessage("rewind", {
        checkpointId: "cp1",
        files: [
          { path: "a.txt", existed: true },
          { path: "new.txt", existed: false },
        ],
      }),
    ).toBe("rewind restored checkpoint cp1 (restored a.txt, deleted new.txt)");
  });

  it("finds the latest checkpoint from tool results", () => {
    const messages: Message[] = [
      { role: "user", content: "edit" },
      {
        role: "tool_result",
        toolCallId: "tc1",
        toolName: "edit_file",
        content: "ok",
        checkpointId: "older",
      },
      { role: "assistant", content: "done" },
      {
        role: "tool_result",
        toolCallId: "tc2",
        toolName: "write_file",
        content: "ok",
        checkpointId: "newer",
      },
    ];

    expect(findLastCheckpoint(messages)).toBe("newer");
  });

  it("rewinds a specific checkpoint and reports restored files", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-rewind-"));
    await writeFile(join(tmp, "a.txt"), "before");
    const checkpoint = await createCheckpoint(tmp, ["a.txt"]);
    await writeFile(join(tmp, "a.txt"), "after");

    const result = await rewindSession({ cwd: tmp }, checkpoint.id);

    expect(result).toEqual({
      checkpointId: checkpoint.id,
      files: [{ path: "a.txt", existed: true }],
    });
    expect(await readFile(join(tmp, "a.txt"), "utf-8")).toBe("before");
    await rm(tmp, { recursive: true, force: true });
  });

  it("revertLast restores the latest mutation checkpoint", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-revert-last-"));
    await writeFile(join(tmp, "a.txt"), "before");
    const checkpoint = await createCheckpoint(tmp, ["a.txt"]);
    await writeFile(join(tmp, "a.txt"), "after");

    const result = await revertLast({
      cwd: tmp,
      messages: [
        {
          role: "tool_result",
          toolCallId: "tc1",
          toolName: "edit_file",
          content: "ok",
          checkpointId: checkpoint.id,
        },
      ],
    });

    expect(result.checkpointId).toBe(checkpoint.id);
    expect(await readFile(join(tmp, "a.txt"), "utf-8")).toBe("before");
    await rm(tmp, { recursive: true, force: true });
  });

  it("revertLast deletes files that did not exist at checkpoint time", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-revert-new-"));
    const checkpoint = await createCheckpoint(tmp, ["new.txt"]);
    await writeFile(join(tmp, "new.txt"), "created");

    await revertLast({
      cwd: tmp,
      messages: [
        {
          role: "tool_result",
          toolCallId: "tc1",
          toolName: "write_file",
          content: "ok",
          checkpointId: checkpoint.id,
        },
      ],
    });

    expect(existsSync(join(tmp, "new.txt"))).toBe(false);
    await rm(tmp, { recursive: true, force: true });
  });

  it("throws clearly when no checkpoint exists", async () => {
    const tmp = await mkdtemp(join(tmpdir(), "myagent-revert-none-"));

    await expect(
      revertLast({
        cwd: tmp,
        messages: [{ role: "assistant", content: "no changes" }],
      }),
    ).rejects.toThrow("No checkpoint found");

    await rm(tmp, { recursive: true, force: true });
  });
});
