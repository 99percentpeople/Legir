import type { TranslateOptionId } from "@/types";

export interface TranslateOption {
  id: TranslateOptionId;
  label: string;
  labelKey?: string;
}

export interface TranslateOptionRegistration {
  id: string;
  label: string;
  labelKey?: string;
}

export interface TranslateOptionGroup {
  id: string;
  label: string;
  labelKey?: string;
  options: TranslateOption[];
}

export interface TranslateOptionGroupRegistration {
  id: string;
  label: string;
  labelKey?: string;
  options: TranslateOptionRegistration[];

  isLLM?: boolean;

  isAvailable: (optionId: string) => boolean;
  unavailableMessageKey?: string;

  translate: (
    text: string,
    optionId: string,
    opts: TranslateTextOptions,
  ) => Promise<string>;
  translateStream?: (
    text: string,
    optionId: string,
    opts: TranslateTextOptions,
  ) => AsyncGenerator<string>;
}

export interface TranslateTextOptions {
  targetLanguage: string;
  sourceLanguage?: string;
  translateOption?: TranslateOptionId;
  prompt?: string;

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

    type CloudTranslateV2Response = {
      data?: {
        translations?: Array<{
          translatedText?: string;
        }>;
      };
    };

    const json = (await res.json()) as CloudTranslateV2Response;
    const translated = json.data?.translations?.[0]?.translatedText;

    if (typeof translated !== "string") {
      throw new Error("Cloud Translation API returned an unexpected response.");
    }

    const decoded = decodeHtmlEntities(translated);
    return decoded.trim();
  }

  async *translateStream(text: string, opts: TranslateTextOptions) {
    yield await this.translate(text, opts);
  }
}

export class TranslateService {
  private groups: TranslateOptionGroupRegistration[] = [];
  private optionToGroup = new Map<
    TranslateOptionId,
    { group: TranslateOptionGroupRegistration; localOptionId: string }
  >();
  private defaultOptionId: TranslateOptionId = "cloud:cloudv2";
  private registryListeners = new Set<() => void>();

  private cloudV2 = new CloudTranslateV2();

  constructor() {
    this.registerOptionGroup({
      id: "cloud",
      label: "Cloud Translation",
      isLLM: false,
      options: [
        {
          id: "cloudv2",
          label: "Cloud Translation v2",
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

  private buildFullOptionId(
    groupId: string,
    optionId: string,
  ): TranslateOptionId {
    return `${groupId}:${optionId}` as TranslateOptionId;
  }

  private parseFullOptionId(
    input: string,
  ): { groupId: string; optionId: string } | null {
    const idx = input.indexOf(":");
    if (idx <= 0) return null;
    return {
      groupId: input.slice(0, idx),
      optionId: input.slice(idx + 1),
    };
  }

  registerOptionGroup(group: TranslateOptionGroupRegistration) {
    this.groups = [...this.groups.filter((g) => g.id !== group.id), group];

    for (const fullId of this.optionToGroup.keys()) {
      if (fullId.startsWith(`${group.id}:`)) {
        this.optionToGroup.delete(fullId);
      }
    }

    for (const opt of group.options) {
      const fullId = this.buildFullOptionId(group.id, opt.id);
      this.optionToGroup.set(fullId, { group, localOptionId: opt.id });
    }

    const firstGroup = this.groups[0];
    const firstLocalId = firstGroup?.options?.[0]?.id;
    if (firstGroup && firstLocalId) {
      const firstFullId = this.buildFullOptionId(firstGroup.id, firstLocalId);
      if (!this.optionToGroup.has(this.defaultOptionId)) {
        this.defaultOptionId = firstFullId;
      }
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
    return this.groups.map((g) => ({
      id: g.id,
      label: g.label,
      labelKey: g.labelKey,
      options: g.options.map((opt) => ({
        id: this.buildFullOptionId(g.id, opt.id),
        label: opt.label,
        labelKey: opt.labelKey,
      })),
    }));
  }

  setDefaultOptionId(optionId: TranslateOptionId) {
    const normalized = this.normalizeTranslateOption(optionId);
    this.defaultOptionId = normalized;
  }

  normalizeTranslateOption(input: unknown): TranslateOptionId {
    const fallback: TranslateOptionId = this.defaultOptionId;
    if (typeof input !== "string") return fallback;

    const parsed = this.parseFullOptionId(input);
    if (parsed) {
      const asId = input as TranslateOptionId;
      return this.optionToGroup.has(asId) ? asId : fallback;
    }

    return fallback;
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
    const entry = this.optionToGroup.get(normalized);
    if (!entry) return false;
    return entry.group.isAvailable(entry.localOptionId);
  }

  isOptionLLM(option: TranslateOptionId) {
    const normalized = this.normalizeTranslateOption(option);
    const entry = this.optionToGroup.get(normalized);
    if (!entry) return false;
    return Boolean(entry.group.isLLM);
  }

  getOptionUnavailableMessageKey(
    option: TranslateOptionId,
  ): string | undefined {
    const normalized = this.normalizeTranslateOption(option);
    const entry = this.optionToGroup.get(normalized);
    if (!entry) return undefined;
    return entry.group.unavailableMessageKey;
  }

  async translate(text: string, opts: TranslateTextOptions): Promise<string> {
    const option = this.resolveTranslateOption(opts);
    const entry = this.optionToGroup.get(option);
    if (!entry) {
      throw new Error(`Unknown translate option: ${option}`);
    }

    return await entry.group.translate(text, entry.localOptionId, opts);
  }

  async *translateStream(
    text: string,
    opts: TranslateTextOptions,
  ): AsyncGenerator<string> {
    const option = this.resolveTranslateOption(opts);
    const entry = this.optionToGroup.get(option);
    if (!entry) {
      throw new Error(`Unknown translate option: ${option}`);
    }

    if (entry.group.translateStream) {
      yield* entry.group.translateStream(text, entry.localOptionId, opts);
      return;
    }

    yield await entry.group.translate(text, entry.localOptionId, opts);
  }
}

export const translateService = new TranslateService();
