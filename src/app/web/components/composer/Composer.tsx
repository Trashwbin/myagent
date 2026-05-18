import React, { useEffect, useMemo, useState } from "react";
import {
  matchingSlashCommands,
  parseSlashCommand,
  slashCommandQuery,
  type SlashCommand,
} from "../../slash-commands.js";

export function Composer({
  value,
  disabled,
  onChange,
  onSend,
  onCommandError,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
  onCommandError?: (message: string) => void;
}) {
  const commands = useMemo(() => matchingSlashCommands(value), [value]);
  const query = slashCommandQuery(value);
  const showCommands = query !== null && commands.length > 0;
  const parsed = parseSlashCommand(value);
  const commandHint =
    parsed.type === "incomplete" || parsed.type === "invalid" || parsed.type === "unknown"
      ? parsed.message
      : parsed.type === "valid"
        ? `Enter runs ${parsed.command.name}.`
      : query !== null
        ? "Use ↑/↓ to choose a command. Enter inserts it."
        : "Type / for commands. Enter sends. Shift+Enter inserts a new line.";
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  function applyCommand(command: SlashCommand) {
    onChange(command.insertText);
  }

  function submit() {
    const command = parseSlashCommand(value);
    if (command.type === "incomplete" || command.type === "invalid" || command.type === "unknown") {
      onCommandError?.(command.message);
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
      <div className="composer-inner">
        <div className="composer-row">
          <textarea
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onKeyDown={(event) => {
              if (showCommands && event.key === "ArrowDown") {
                event.preventDefault();
                setSelectedIndex((index) => (index + 1) % commands.length);
                return;
              }
              if (showCommands && event.key === "ArrowUp") {
                event.preventDefault();
                setSelectedIndex((index) => (index + commands.length - 1) % commands.length);
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
            <div className="model-badge">
              <span className="dot connected" />
              <span>myAgent</span>
            </div>
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
