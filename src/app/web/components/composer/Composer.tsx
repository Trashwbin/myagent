import React from "react";

export function Composer({
  value,
  disabled,
  onChange,
  onSend,
}: {
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
  onSend: () => void;
}) {
  return (
    <section className="composer">
      <div className="composer-inner">
        <textarea
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              if (!disabled) onSend();
            }
          }}
          disabled={disabled}
          placeholder="Ask myAgent to inspect, edit, test, or explain this workspace..."
        />
        <button className="primary" onClick={onSend} disabled={disabled}>
          Send
        </button>
      </div>
      <div className="hint">
        Enter sends. Shift+Enter inserts a new line. Browser-native selection, copy, IME, and scrolling are preserved.
      </div>
    </section>
  );
}
