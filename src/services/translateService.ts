import type { TranslateOptionId } from "@/types";

export interface TranslateOption {
  id: TranslateOptionId;
  label: string;
  labelKey?: string;
}

export interface TranslateOptionGroup {
  id: string;
  label: string;
  labelKey?: string;
  options: TranslateOption[];

  isAvailable: (optionId: TranslateOptionId) => boolean;
  unavailableMessageKey?: string;

  translate: (
    text: string,
    optionId: TranslateOptionId,
    opts: TranslateTextOptions,
  ) => Promise<string>;
  translateStream?: (
    text: string,
    optionId: TranslateOptionId,
    opts: TranslateTextOptions,
  ) => AsyncGenerator<string>;
}

export interface TranslateTextOptions {
  targetLanguage: string;
  sourceLanguage?: string;
  translateOption?: TranslateOptionId;

  // Back-compat (prefer translateOption)
  model?: string;
  provider?: string;

  signal?: AbortSignal;
}

const getCloudTranslationApiKey = () => {
  return process.env.GOOGLE_TRANSLATE_API_KEY;
};

const decodeHtmlEntities = (text: string) => {
  if (typeof document === "undefined") return text;
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
};

class CloudTranslateV2 {
  isAvailable() {
    return !!getCloudTranslationApiKey();
  }

  async translate(text: string, opts: TranslateTextOptions) {
    const apiKey = getCloudTranslationApiKey();
    if (!apiKey) {
      throw new Error("No API Key provided for Cloud Translation API.");
    }

    const res = await fetch(
      `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(
        apiKey,
      )}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          q: text,
          target: opts.targetLanguage,
          source: opts.sourceLanguage,
          format: "text",
        }),
        signal: opts.signal,
      },
    );

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(
        `Cloud Translation API request failed (${res.status}): ${errText || res.statusText}`,
      );
    }

    const json = (await res.json()) as any;
    const translated =
      json?.data?.translations?.[0]?.translatedText ??
      json?.data?.translations?.[0]?.translated_text;

    if (typeof translated !== "string") {
      throw new Error("Cloud Translation API returned an unexpected response.");
    }

    return decodeHtmlEntities(translated).trim();
  }

  async *translateStream(text: string, opts: TranslateTextOptions) {
    yield await this.translate(text, opts);
  }
}

export class TranslateService {
  private groups: TranslateOptionGroup[] = [];
  private optionToGroup = new Map<TranslateOptionId, TranslateOptionGroup>();
  private defaultOptionId: TranslateOptionId = "cloud";
  private registryListeners = new Set<() => void>();

  private cloudV2 = new CloudTranslateV2();

  constructor() {
    this.registerOptionGroup({
      id: "cloud",
      label: "Cloud Translation API",
      labelKey: "translate.provider_cloud",
      options: [
        {
          id: "cloud",
          label: "Cloud Translation API",
          labelKey: "translate.provider_cloud",
        },
      ],
      isAvailable: () => this.cloudV2.isAvailable(),
      unavailableMessageKey: "translate.cloud_api_key_missing",
      translate: async (text, _optionId, opts) => {
        return await this.cloudV2.translate(text, opts);
      },
      translateStream: (text, _optionId, opts) => {
        return this.cloudV2.translateStream(text, opts);
      },
    });
  }

  registerOptionGroup(group: TranslateOptionGroup) {
    this.groups = [...this.groups.filter((g) => g.id !== group.id), group];

    for (const opt of group.options) {
      this.optionToGroup.set(opt.id, group);
    }

    const first = this.groups[0]?.options?.[0]?.id;
    if (first && !this.optionToGroup.has(this.defaultOptionId)) {
      this.defaultOptionId = first;
    }

    for (const listener of this.registryListeners) listener();
  }

  subscribe(listener: () => void) {
    this.registryListeners.add(listener);
    return () => {
      this.registryListeners.delete(listener);
    };
  }

  getOptionGroups(): TranslateOptionGroup[] {
    return this.groups;
  }

  setDefaultOptionId(optionId: TranslateOptionId) {
    const normalized = this.normalizeTranslateOption(optionId);
    this.defaultOptionId = normalized;
  }

  normalizeTranslateOption(input: unknown): TranslateOptionId {
    const fallback: TranslateOptionId = this.defaultOptionId;
    if (typeof input !== "string") return fallback;
    const asId = input as TranslateOptionId;
    return this.optionToGroup.has(asId) ? asId : fallback;
  }

  private resolveTranslateOption(
    opts: TranslateTextOptions,
  ): TranslateOptionId {
    if (opts.translateOption) {
      return this.normalizeTranslateOption(opts.translateOption);
    }

    if (opts.provider && opts.model) {
      return this.normalizeTranslateOption(`${opts.provider}:${opts.model}`);
    }

    if (opts.provider) {
      return this.normalizeTranslateOption(opts.provider);
    }

    if (opts.model) {
      return this.normalizeTranslateOption(`gemini:${opts.model}`);
    }

    return this.defaultOptionId;
  }

  isOptionAvailable(option: TranslateOptionId) {
    const normalized = this.normalizeTranslateOption(option);
    const group = this.optionToGroup.get(normalized);
    if (!group) return false;
    return group.isAvailable(normalized);
  }

  getOptionUnavailableMessageKey(
    option: TranslateOptionId,
  ): string | undefined {
    const normalized = this.normalizeTranslateOption(option);
    const group = this.optionToGroup.get(normalized);
    if (!group) return undefined;
    return group.unavailableMessageKey;
  }

  async translate(text: string, opts: TranslateTextOptions): Promise<string> {
    const option = this.resolveTranslateOption(opts);
    const group = this.optionToGroup.get(option);
    if (!group) {
      throw new Error(`Unknown translate option: ${option}`);
    }

    return await group.translate(text, option, opts);
  }

  async *translateStream(
    text: string,
    opts: TranslateTextOptions,
  ): AsyncGenerator<string> {
    const option = this.resolveTranslateOption(opts);
    const group = this.optionToGroup.get(option);
    if (!group) {
      throw new Error(`Unknown translate option: ${option}`);
    }

    if (group.translateStream) {
      yield* group.translateStream(text, option, opts);
      return;
    }

    yield await group.translate(text, option, opts);
  }
}

export const translateService = new TranslateService();
