import { describe, expect, it } from "vitest";
import {
  matchingSlashCommands,
  parseSlashCommand,
  slashCommandQuery,
} from "../src/app/web/slash-commands.js";

describe("web slash commands", () => {
  it("shows all commands for slash input", () => {
    expect(slashCommandQuery("/")).toBe("");
    expect(matchingSlashCommands("/").map((command) => command.name)).toEqual([
      "/compact",
      "/revert-last",
      "/rewind",
      "/model",
    ]);
  });

  it("filters commands by command prefix", () => {
    expect(matchingSlashCommands("/co").map((command) => command.name)).toEqual([
      "/compact",
    ]);
  });

  it("parses valid compact and revert commands", () => {
    expect(parseSlashCommand("/compact")).toMatchObject({
      type: "valid",
      command: { id: "compact" },
      args: "",
    });
    expect(parseSlashCommand("/revert-last")).toMatchObject({
      type: "valid",
      command: { id: "revert-last" },
      args: "",
    });
  });

  it("requires a checkpoint id for rewind", () => {
    expect(parseSlashCommand("/rewind")).toMatchObject({
      type: "incomplete",
      command: { id: "rewind" },
    });
    expect(parseSlashCommand("/rewind cp_123")).toMatchObject({
      type: "valid",
      command: { id: "rewind" },
      args: "cp_123",
    });
  });

  it("parses model list and model switch commands", () => {
    expect(parseSlashCommand("/model")).toMatchObject({
      type: "valid",
      command: { id: "model" },
      args: "",
    });
    expect(parseSlashCommand("/model anthropic/sonnet")).toMatchObject({
      type: "valid",
      command: { id: "model" },
      args: "anthropic/sonnet",
    });
  });

  it("rejects unknown commands and extra compact arguments", () => {
    expect(parseSlashCommand("/missing")).toMatchObject({
      type: "unknown",
    });
    expect(parseSlashCommand("/compact now")).toMatchObject({
      type: "invalid",
      command: { id: "compact" },
    });
  });
});
