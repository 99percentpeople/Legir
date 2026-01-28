import type { LLMProvider, LLMProviderId } from "./types";

export class LLMService {
  private providers = new Map<LLMProviderId, LLMProvider>();
  private defaultProviderId: LLMProviderId | null = null;

  registerProvider(provider: LLMProvider) {
    this.providers.set(provider.id, provider);
    if (!this.defaultProviderId) this.defaultProviderId = provider.id;
  }

  setDefaultProviderId(id: LLMProviderId) {
    if (!this.providers.has(id)) {
      throw new Error(`Unknown LLM provider: ${id}`);
    }
    this.defaultProviderId = id;
  }

  getProvider<T extends LLMProvider = LLMProvider>(
    id: LLMProviderId,
  ): T | undefined {
    return this.providers.get(id) as T | undefined;
  }

  getDefaultProvider<T extends LLMProvider = LLMProvider>(): T {
    if (!this.defaultProviderId) {
      throw new Error("No default LLM provider configured.");
    }
    const provider = this.providers.get(this.defaultProviderId);
    if (!provider) {
      throw new Error(
        `Unknown default LLM provider: ${this.defaultProviderId}`,
      );
    }
    return provider as T;
  }

  isProviderAvailable(id: LLMProviderId) {
    return this.providers.get(id)?.isAvailable() ?? false;
  }

  getProviders(): LLMProvider[] {
    return Array.from(this.providers.values());
  }
}

export const llmService = new LLMService();
