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

  it("opens a second-level picker for rewind", () => {
    expect(parseSlashCommand("/rewind")).toMatchObject({
      type: "valid",
      command: { id: "rewind" },
      args: "",
    });
    expect(parseSlashCommand("/rewind cp_123")).toMatchObject({
      type: "invalid",
      command: { id: "rewind" },
    });
  });

  it("rejects unknown commands and extra compact arguments", () => {
    expect(parseSlashCommand("/missing")).toMatchObject({
      type: "unknown",
    });
    expect(parseSlashCommand("/model")).toMatchObject({
      type: "unknown",
    });
    expect(parseSlashCommand("/compact now")).toMatchObject({
      type: "invalid",
      command: { id: "compact" },
    });
  });
});
