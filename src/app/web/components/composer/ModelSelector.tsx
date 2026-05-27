import React, { useEffect, useMemo, useRef, useState } from "react";
import type { SessionContextUsage } from "../../../../model/types.js";
import type {
  ProviderConfig,
  ProviderModelSummary,
  ProviderSummary,
} from "../../state/types.js";

type MenuKind = "provider" | "model" | "effort";

type ModelGroup = {
  provider: ProviderSummary;
  models: ModelChoice[];
};

type ModelChoice = {
  key: string;
  label: string;
  displayName?: string;
  base?: ProviderModelSummary;
  variants: VariantChoice[];
};

type VariantChoice = {
  key: string;
  label: string;
  profile: ProviderModelSummary;
};

export function ModelSelector({
  config,
  selectedModelId,
  contextUsage,
  disabled,
  onSelect,
}: {
  config: ProviderConfig | null;
  selectedModelId: string;
  contextUsage?: SessionContextUsage;
  disabled?: boolean;
  onSelect: (modelProfileId: string) => void;
}) {
  const [openMenu, setOpenMenu] = useState<MenuKind | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const grouped = useMemo(() => groupModels(config), [config]);
  const selected = useMemo(
    () => selectedModel(grouped, selectedModelId),
    [grouped, selectedModelId],
  );

  useEffect(() => {
    if (!openMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpenMenu(null);
      }
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [openMenu]);

  if (!config || config.models.length === 0) {
    return (
      <div className="model-selector is-empty" aria-label="No configured models">
        <span className="model-pill model-pill-muted">model</span>
      </div>
    );
  }

  const providerLabel =
    selected?.provider.provider.name || selected?.provider.provider.id || "provider";
  const currentModel = selected?.model;
  const currentVariant = selected?.variant;
  const contextWindow =
    currentVariant?.profile.contextWindow ?? currentModel?.base?.contextWindow;
  const modelLabel = currentModel?.label ?? (selectedModelId || "model");
  const effortLabel = currentVariant?.label ?? "Default";
  const hasEfforts = !!currentModel && currentModel.variants.length > 0;

  return (
    <div className="model-selector" ref={rootRef}>
      <button
        type="button"
        className="model-pill model-provider-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={openMenu === "provider"}
        onClick={() => setOpenMenu((menu) => (menu === "provider" ? null : "provider"))}
      >
        <span className="model-pill-text">{formatProviderLabel(providerLabel)}</span>
      </button>

      <ContextWindowBadge usage={contextUsage} contextWindow={contextWindow} />

      <div className="model-choice-group">
        <button
          type="button"
          className="model-pill model-model-trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={openMenu === "model"}
          onClick={() => setOpenMenu((menu) => (menu === "model" ? null : "model"))}
        >
          <span className="model-pill-text model-name">
            {formatModelLabel(modelLabel)}
          </span>
        </button>

        {hasEfforts ? (
          <button
            type="button"
            className="model-pill model-effort-trigger"
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={openMenu === "effort"}
            onClick={() => setOpenMenu((menu) => (menu === "effort" ? null : "effort"))}
          >
            <span className="model-pill-text">{formatEffortLabel(effortLabel)}</span>
          </button>
        ) : null}
      </div>

      {openMenu === "provider" ? (
        <div
          className="model-menu model-menu-provider"
          role="listbox"
          aria-label="Select provider"
        >
          {grouped.map((group) => (
            <button
              key={group.provider.id}
              type="button"
              className={`model-option${group.provider.id === selected?.provider.provider.id ? " active" : ""}`}
              role="option"
              aria-selected={group.provider.id === selected?.provider.provider.id}
              onClick={() => {
                onSelect(selectProviderProfile(group, selected));
                setOpenMenu(null);
              }}
            >
              <span className="model-option-main">
                <span className="model-option-name">
                  {formatProviderLabel(group.provider.name || group.provider.id)}
                </span>
                <span className="model-option-id">{group.provider.id}</span>
              </span>
              <span className="model-option-meta">{group.models.length} models</span>
            </button>
          ))}
        </div>
      ) : null}

      {openMenu === "model" && selected ? (
        <div
          className="model-menu model-menu-model"
          role="listbox"
          aria-label="Select model"
        >
          {selected.provider.models.map((model) => (
            <button
              key={model.key}
              type="button"
              className={`model-option${model.key === selected.model.key ? " active" : ""}`}
              role="option"
              aria-selected={model.key === selected.model.key}
              onClick={() => {
                onSelect(selectModelProfile(model, selected.variant?.key));
                setOpenMenu(null);
              }}
            >
              <span className="model-option-main">
                <span className="model-option-name">{formatModelLabel(model.label)}</span>
                {model.displayName ? (
                  <span className="model-option-id">{model.displayName}</span>
                ) : null}
              </span>
              <span className="model-option-meta">
                {model.variants.length > 0
                  ? `${model.variants.length} efforts`
                  : "default"}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      {openMenu === "effort" && currentModel ? (
        <div
          className="model-menu model-menu-effort"
          role="listbox"
          aria-label="Select effort"
        >
          {currentModel.variants.length > 0 ? (
            currentModel.variants.map((variant) => (
              <button
                key={variant.key}
                type="button"
                className={`model-option${variant.key === currentVariant?.key ? " active" : ""}`}
                role="option"
                aria-selected={variant.key === currentVariant?.key}
                onClick={() => {
                  onSelect(variant.profile.id);
                  setOpenMenu(null);
                }}
              >
                <span className="model-option-main">
                  <span className="model-option-name">
                    {formatEffortLabel(variant.label)}
                  </span>
                </span>
              </button>
            ))
          ) : (
            <div className="model-menu-empty">No efforts for this model.</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ContextWindowBadge({
  usage,
  contextWindow,
}: {
  usage?: SessionContextUsage;
  contextWindow?: number;
}) {
  const [open, setOpen] = useState(false);
  const effectiveContextWindow = usage?.contextWindow ?? contextWindow;
  const usedTokens = usage?.usedTokens;
  const hasUsage = typeof usedTokens === "number" && usedTokens > 0;
  const detail =
    effectiveContextWindow && hasUsage
      ? `${usage?.source === "estimate" ? "~" : ""}${formatTokenCount(usedTokens)} / ${formatTokenCount(effectiveContextWindow)} tokens used`
      : effectiveContextWindow
        ? `${formatTokenCount(effectiveContextWindow)} context window`
        : "Context window unavailable";
  const percent = usage?.percentFull;
  const fullness = percent === undefined ? "No usage data yet" : `${percent}% full`;
  const label = `Context window. ${fullness}. ${detail}`;
  const ringPercent = percent === undefined || percent <= 0 ? 0 : Math.max(percent, 8);

  return (
    <div
      className="context-window-badge"
      tabIndex={0}
      aria-label={label}
      onBlur={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span
        className="context-window-ring"
        aria-hidden="true"
        style={
          {
            "--context-window-progress": `${Math.min(ringPercent, 100)}%`,
          } as React.CSSProperties
        }
      />
      {open ? (
        <div className="context-window-popover" role="tooltip">
          <div className="context-window-header">
            <span className="context-window-title">Context window:</span>
            <span className="context-window-fullness">{fullness}</span>
          </div>
          <div className="context-window-detail">{detail}</div>
        </div>
      ) : null}
    </div>
  );
}

function groupModels(config: ProviderConfig | null): ModelGroup[] {
  if (!config) return [];
  const providers = new Map<string, ModelGroup>();

  for (const provider of config.providers) {
    providers.set(provider.id, { provider, models: [] });
  }

  for (const profile of config.models) {
    const providerId = profile.providerID || profile.provider;
    if (!providerId) continue;
    const group =
      providers.get(providerId) ??
      ({ provider: fallbackProvider(providerId), models: [] } satisfies ModelGroup);
    if (!providers.has(providerId)) providers.set(providerId, group);

    const modelKey = profile.modelID || profile.model || profile.id;
    let model = group.models.find((item) => item.key === modelKey);
    if (!model) {
      model = {
        key: modelKey,
        label: profile.model || profile.modelID || modelKey,
        displayName: modelDisplayName(profile),
        base: undefined,
        variants: [],
      };
      group.models.push(model);
    }

    if (profile.variant) {
      model.variants.push({
        key: profile.variant,
        label: profile.variant,
        profile,
      });
    } else {
      model.base = profile;
      model.displayName = modelDisplayName(profile);
    }
  }

  for (const group of providers.values()) {
    group.models.sort((a, b) => a.label.localeCompare(b.label));
    for (const model of group.models) {
      model.variants.sort((a, b) => effortRank(a.key) - effortRank(b.key));
    }
  }

  return [...providers.values()].filter((provider) => provider.models.length > 0);
}

function selectedModel(groups: ModelGroup[], selectedModelId: string) {
  for (const provider of groups) {
    for (const model of provider.models) {
      if (model.base?.id === selectedModelId) {
        return { provider, model, variant: undefined };
      }
      const variant = model.variants.find((item) => item.profile.id === selectedModelId);
      if (variant) return { provider, model, variant };
    }
  }

  const firstProvider = groups[0];
  const firstModel = firstProvider?.models[0];
  if (!firstProvider || !firstModel) return null;
  return {
    provider: firstProvider,
    model: firstModel,
    variant: firstModel.variants[0],
  };
}

function selectProviderProfile(
  target: ModelGroup,
  selected: ReturnType<typeof selectedModel>,
): string {
  const sameModel = selected
    ? target.models.find((model) => model.key === selected.model.key)
    : undefined;
  return selectModelProfile(sameModel ?? target.models[0]!, selected?.variant?.key);
}

function selectModelProfile(model: ModelChoice, preferredVariant?: string): string {
  const matchingVariant = preferredVariant
    ? model.variants.find((variant) => variant.key === preferredVariant)
    : undefined;
  return (
    matchingVariant?.profile.id ?? model.base?.id ?? model.variants[0]?.profile.id ?? ""
  );
}

function fallbackProvider(providerId: string): ProviderSummary {
  return {
    id: providerId,
    name: providerId,
    adapters: [],
    models: [],
  };
}

function modelDisplayName(model: ProviderModelSummary): string | undefined {
  const name = model.name?.trim();
  const base = model.model || model.modelID || model.id;
  return name && name !== base ? name : undefined;
}

function formatProviderLabel(value: string): string {
  if (value.toLowerCase() === "openai") return "OpenAI";
  return value;
}

function formatModelLabel(value: string): string {
  return value
    .replace(/^gpt-/i, "")
    .replace(/^claude-/i, "")
    .replace(/-/g, " ");
}

function formatEffortLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (normalized === "xhigh") return "Extra High";
  if (normalized === "max") return "Max";
  if (normalized === "default") return "Default";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function effortRank(value: string): number {
  const order = ["none", "minimal", "low", "medium", "high", "xhigh", "max"];
  const index = order.indexOf(value);
  return index === -1 ? order.length : index;
}

function formatTokenCount(value: number): string {
  if (value >= 1000) {
    const rounded = Math.round(value / 1000);
    return `${rounded}k`;
  }
  return String(value);
}
