import { ReviewFinding } from './reviewRules';

export type AiProviderName = 'disabled' | 'anthropic' | 'openai';

export type AiProviderConfig = {
  name: AiProviderName;
  apiKey?: string;
  model?: string;
};

export type AiReviewRequest = {
  prompt: string;
  relativeFilePath: string;
  framework: string;
};

export type AiReviewResponse = {
  provider: string;
  wasUsed: boolean;
  message: string;
  additionalFindings: ReviewFinding[];
};

export interface AiProvider {
  name: string;
  isConfigured(): boolean;
  review(request: AiReviewRequest): Promise<AiReviewResponse>;
}

// ─── Placeholder provider ─────────────────────────────────────────────────────
// Step 32: replace this with a real provider factory that reads AiProviderConfig
// from environment variables (ANTHROPIC_API_KEY / OPENAI_API_KEY) and returns
// the appropriate implementation. The disabled provider should remain as the
// safe fallback when no API key is present.

export function createDisabledAiProvider(): AiProvider {
  return {
    name: 'disabled',
    isConfigured(): boolean {
      return false;
    },
    async review(_request: AiReviewRequest): Promise<AiReviewResponse> {
      return {
        provider: 'disabled',
        wasUsed: false,
        message: 'AI provider is not configured. Deterministic review only.',
        additionalFindings: [],
      };
    },
  };
}
