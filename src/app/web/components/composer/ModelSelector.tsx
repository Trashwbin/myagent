import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  ProviderConfig,
  ProviderModelSummary,
  ProviderSummary,
} from "../../state/types.js";

export function ModelSelector({
  config,
  selectedModelId,
  disabled,
  onSelect,
}: {
  config: ProviderConfig | null;
  selectedModelId: string;
  disabled?: boolean;
  onSelect: (modelProfileId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selected = useMemo(
    () => config?.models.find((model) => model.id === selectedModelId) ?? null,
    [config, selectedModelId],
  );

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  if (!config || config.models.length === 0) {
    return (
      <div className="model-badge muted" aria-label="No configured models">
        <span className="dot" />
        <span>model</span>
      </div>
    );
  }

  const label = selected ? modelPrimaryLabel(selected) : selectedModelId || "model";
  const provider = selected?.providerID ?? selected?.provider ?? "";

  return (
    <div className="model-selector" ref={rootRef}>
      <button
        type="button"
        className="model-badge model-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="dot connected" />
        <span className="model-trigger-text">
          {provider ? <span className="model-provider">{provider}</span> : null}
          <span className="model-name">{label}</span>
        </span>
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4.5 6.5 8 10l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div className="model-menu" role="listbox" aria-label="Select model">
          {config.providers.map((provider) => (
            <ProviderGroup
              key={provider.id}
              provider={provider}
              selectedModelId={selectedModelId}
              onSelect={(modelId) => {
                onSelect(modelId);
                setOpen(false);
              }}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ProviderGroup({
  provider,
  selectedModelId,
  onSelect,
}: {
  provider: ProviderSummary;
  selectedModelId: string;
  onSelect: (modelProfileId: string) => void;
}) {
  return (
    <section className="model-provider-group">
      <div className="model-provider-heading">{provider.name || provider.id}</div>
      {provider.models.map((model) => {
        const active = model.id === selectedModelId;
        return (
          <button
            key={model.id}
            type="button"
            className={`model-option${active ? " active" : ""}`}
            role="option"
            aria-selected={active}
            onClick={() => onSelect(model.id)}
          >
            <span className="model-option-main">
              <span className="model-option-name">{modelPrimaryLabel(model)}</span>
              {modelDisplayName(model) ? (
                <span className="model-option-id">{modelDisplayName(model)}</span>
              ) : null}
            </span>
            <span className="model-option-meta">{model.mode || adapterLabel(model.adapter)}</span>
          </button>
        );
      })}
    </section>
  );
}

function modelPrimaryLabel(model: ProviderModelSummary): string {
  return model.model || model.modelID || model.id;
}

function modelDisplayName(model: ProviderModelSummary): string | undefined {
  const name = model.name?.trim();
  return name && name !== modelPrimaryLabel(model) ? name : undefined;
}

function adapterLabel(adapter: string): string {
  if (adapter.includes("anthropic")) return "messages";
  if (adapter.includes("openai-compatible")) return "chat";
  if (adapter.includes("openai")) return "responses";
  return adapter;
}
