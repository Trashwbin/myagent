import type { ModelProfile } from "../config/config.js";
import { AiSdkProvider } from "./ai-sdk-provider.js";
import type { Provider } from "./provider.js";

export function createProviderFromProfile(profile: ModelProfile): Provider {
  if (profile.adapter === "@ai-sdk/openai" || profile.adapter === "@ai-sdk/openai-compatible") {
    if (!profile.apiKey) {
      throw new Error(
        `Model ${profile.id} requires apiKey in config.provider.${profile.provider}.options or the model profile.`,
      );
    }
    return new AiSdkProvider({
      provider: "openai",
      adapter: profile.adapter,
      model: profile.model,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      maxOutputTokens: profile.maxOutputTokens,
      mode: profile.mode,
      options: profile.options,
    });
  }

  if (!profile.apiKey && !profile.authToken) {
    throw new Error(
      `Model ${profile.id} requires apiKey or authToken in config.provider.${profile.provider}.options or the model profile.`,
    );
  }
  return new AiSdkProvider({
    provider: "anthropic",
    adapter: profile.adapter,
    model: profile.model,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    authToken: profile.authToken,
    maxOutputTokens: profile.maxOutputTokens,
    mode: profile.mode,
    options: profile.options,
  });
}

export function publicModelProfile(profile: ModelProfile): {
  id: string;
  provider: string;
  providerID: string;
  modelID: string;
  adapter: string;
  model: string;
  name?: string;
  variant?: string;
  variants?: string[];
  mode?: string;
} {
  return {
    id: profile.id,
    provider: profile.provider,
    providerID: profile.provider,
    modelID: profile.model,
    adapter: profile.adapter,
    model: profile.model,
    name: profile.name ?? profile.model,
    variant: profile.variant,
    variants: profile.variants,
    mode: profile.mode,
  };
}
