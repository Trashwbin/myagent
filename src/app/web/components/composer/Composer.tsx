import React, { useEffect, useMemo, useState } from "react";
import {
  matchingSlashCommands,
  parseSlashCommand,
  slashCommandQuery,
  type SlashCommand,
} from "../../slash-commands.js";
import type { ProviderConfig } from "../../state/types.js";
import { ModelSelector } from "./ModelSelector.js";

export type SlashChoice =
  | {
      type: "model";
      id: string;
      label: string;
      description: string;
      active?: boolean;
    }
  | {
      type: "checkpoint";
      id: string;
      label: string;
      description: string;
    };

export function Composer({
  value,
  disabled,
  onChange,
  onSend,
  onCommandError,
  providerConfig,
  selectedModelId,
  onSelectModel,
  slashChoices,
  onSlashChoice,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onCommandError?: (message: string) => void;
  providerConfig: ProviderConfig | null;
  selectedModelId: string;
  onSelectModel: (modelProfileId: string) => void;
  slashChoices: SlashChoice[];
  onSlashChoice: (choice: SlashChoice) => void;
}) {
  const commands = useMemo(() => matchingSlashCommands(value), [value]);
  const query = slashCommandQuery(value);
  const parsed = parseSlashCommand(value);
  const activePicker =
    parsed.type === "valid" && parsed.command.picker ? parsed.command.picker : null;
  const choices = useMemo(
    () => slashChoices.filter((choice) => choice.type === activePicker),
    [slashChoices, activePicker],
  );
  const showChoices = !!activePicker;
  const showCommands = !showChoices && query !== null && commands.length > 0;
  const commandHint =
    parsed.type === "incomplete" || parsed.type === "invalid" || parsed.type === "unknown"
      ? parsed.message
      : showChoices && choices.length > 0
        ? "Choose an item with ↑/↓, then press Enter."
      : showChoices
        ? activePicker === "checkpoint"
          ? "No checkpoints found in this session."
          : "No configured models found."
      : parsed.type === "valid"
        ? `Enter runs ${parsed.command.name}.`
      : query !== null
        ? "Use ↑/↓ to choose a command. Enter inserts it."
        : "Type / for commands. Enter sends. Shift+Enter inserts a new line.";
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query, activePicker]);

  function applyCommand(command: SlashCommand) {
    onChange(command.insertText);
  }

  function submit() {
    const command = parseSlashCommand(value);
    if (command.type === "incomplete" || command.type === "invalid" || command.type === "unknown") {
      onCommandError?.(command.message);
      return;
    }
    if (command.type === "valid" && command.command.picker) {
      const choice = choices[selectedIndex];
      if (choice) {
        onSlashChoice(choice);
        return;
      }
      onCommandError?.(
        command.command.picker === "checkpoint"
          ? "No checkpoints found in this session."
          : "No configured models found.",
      );
      return;
    }
    onSend();
  }

  return (
    <section className="composer">
      {showCommands ? (
        <div className="slash-menu" role="listbox" aria-label="Slash commands">
          {commands.map((command, index) => (
            <button
              key={command.id}
              type="button"
              className={`slash-command${index === selectedIndex ? " selected" : ""}`}
              onMouseDown={(event) => {
                event.preventDefault();
                applyCommand(command);
              }}
              role="option"
              aria-selected={index === selectedIndex}
            >
              <span className="slash-command-name">{command.usage}</span>
              <span className="slash-command-description">{command.description}</span>
            </button>
          ))}
        </div>
      ) : null}
      {showChoices ? (
        <div className="slash-menu slash-choice-menu" role="listbox" aria-label="Command options">
          {choices.length > 0 ? (
            choices.map((choice, index) => (
              <button
                key={`${choice.type}:${choice.id}`}
                type="button"
                className={`slash-command slash-choice${index === selectedIndex ? " selected" : ""}`}
                onMouseDown={(event) => {
                  event.preventDefault();
                  onSlashChoice(choice);
                }}
                role="option"
                aria-selected={index === selectedIndex}
              >
                <span className="slash-command-name">{choice.label}</span>
                <span className="slash-command-description">
                  {choice.description}
                  {"active" in choice && choice.active ? " · active" : ""}
                </span>
              </button>
            ))
          ) : (
            <div className="slash-empty">
              {activePicker === "checkpoint"
                ? "No checkpoints found in this session."
                : "No configured models found."}
            </div>
          )}
        </div>
      ) : null}
      <div className="composer-inner">
        <div className="composer-row">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if ((showCommands || showChoices) && event.key === "ArrowDown") {
                event.preventDefault();
                const length = showChoices ? choices.length : commands.length;
                if (length > 0) setSelectedIndex((index) => (index + 1) % length);
                return;
              }
              if ((showCommands || showChoices) && event.key === "ArrowUp") {
                event.preventDefault();
                const length = showChoices ? choices.length : commands.length;
                if (length > 0) setSelectedIndex((index) => (index + length - 1) % length);
                return;
              }
              if (showCommands && event.key === "Tab") {
                event.preventDefault();
                applyCommand(commands[selectedIndex]!);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                const command = parseSlashCommand(value);
                if (command.type === "valid") {
                  submit();
                  return;
                }
                if (command.type === "incomplete" || command.type === "invalid") {
                  submit();
                  return;
                }
                if (showChoices) {
                  submit();
                  return;
                }
                if (showCommands && commands[selectedIndex]) {
                  applyCommand(commands[selectedIndex]);
                  return;
                }
                if (!disabled) submit();
              }
            }}
            disabled={disabled}
            placeholder="Ask myAgent..."
            rows={1}
          />
        </div>
        <div className="composer-actions">
          <div className="composer-left-actions" />
          <div className="composer-right-actions">
            <ModelSelector
              config={providerConfig}
              selectedModelId={selectedModelId}
              disabled={disabled}
              onSelect={onSelectModel}
            />
            <button className="send-button" onClick={submit} disabled={disabled}>
              <svg viewBox="0 0 16 16" fill="none">
                <path d="M8 13.5v-11M4.5 6.5L8 2.5l3.5 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
          </div>
        </div>
      </div>
      <div className="hint"><span>{commandHint}</span></div>
    </section>
  );
}
