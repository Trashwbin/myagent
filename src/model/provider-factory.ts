import type { ModelProfile } from "../config/config.js";
import { AiSdkProvider } from "./ai-sdk-provider.js";
import type { Provider } from "./provider.js";

export function createProviderFromProfile(profile: ModelProfile): Provider {
  if (profile.type === "openai") {
    if (!profile.apiKey) {
      throw new Error(
        `Model ${profile.id} requires apiKey in config.providers.${profile.provider} or the model profile.`,
      );
    }
    return new AiSdkProvider({
      provider: "openai",
      model: profile.model,
      baseUrl: profile.baseUrl,
      apiKey: profile.apiKey,
      maxOutputTokens: profile.maxOutputTokens,
      protocol: profile.protocol,
    });
  }

  if (!profile.apiKey && !profile.authToken) {
    throw new Error(
      `Model ${profile.id} requires apiKey or authToken in config.providers.${profile.provider} or the model profile.`,
    );
  }
  return new AiSdkProvider({
    provider: "anthropic",
    model: profile.model,
    baseUrl: profile.baseUrl,
    apiKey: profile.apiKey,
    authToken: profile.authToken,
    maxOutputTokens: profile.maxOutputTokens,
  });
}

export function publicModelProfile(profile: ModelProfile): {
  id: string;
  provider: string;
  type: string;
  model: string;
  name?: string;
} {
  return {
    id: profile.id,
    provider: profile.provider,
    type: profile.type,
    model: profile.model,
    name: profile.name,
  };
}
