import { ReviewFinding } from './reviewRules';

export type AiProviderName = 'disabled' | 'openai' | 'anthropic' | 'gemini' | 'deepseek';

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

export type AiReviewResponseStatus = 'completed' | 'skipped' | 'error' | 'not-implemented';

export type AiReviewResponse = {
  status: AiReviewResponseStatus;
  provider: string;
  model?: string;
  content?: string;
  wasUsed: boolean;
  message: string;
  errorMessage?: string;
  additionalFindings: ReviewFinding[];
};

export interface AiProvider {
  name: string;
  isConfigured(): boolean;
  review(request: AiReviewRequest): Promise<AiReviewResponse>;
}

// ─── Shared utilities for all providers ──────────────────────────────────────

export const REVIEW_SYSTEM_MESSAGE = [
  'You are a QA automation expert reviewing an automated test file.',
  'Your role is to enhance the analysis produced by a deterministic static reviewer.',
  'You must follow these rules strictly:',
  '',
  'Safety rules:',
  '- Only provide actionable recommendations. Do not write full replacement files.',
  '- Do not produce patches, diffs, or code that is meant to be applied automatically.',
  '- Do not suggest self-healing, auto-fixing, or any automated file modification.',
  '- Do not suggest running commands that modify the target files.',
  '',
  'Evidence rules:',
  '- Do not invent findings. Only comment on what is explicitly present in the provided context.',
  '- Do not use language like "it is likely", "probably", "may contain", or "common patterns suggest".',
  '- Do not mention files, helpers, selectors, or test flows that were not provided in the prompt.',
  '- Do not suggest specific spec file names unless they are derived from the current file or findings.',
  '- If something cannot be confirmed from the provided context, label it clearly as "Needs confirmation".',
  '',
  'Response rules:',
  '- Keep suggestions QA-focused, specific, and tied to the evidence provided.',
  '- Keep the response concise. Do not repeat what the deterministic reviewer already stated.',
  '- Format your response with clear sections and concise bullet points.',
].join('\n');

export function safeErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : 'Unknown error';
  // Redact anything resembling an API key to prevent accidental secret exposure
  return raw.replace(/[A-Za-z0-9_-]{20,}/g, (m) =>
    /^[A-Za-z0-9_-]+$/.test(m) && m.length >= 30 ? '[REDACTED]' : m
  );
}

// ─── Disabled provider ────────────────────────────────────────────────────────

export function createDisabledAiProvider(): AiProvider {
  return {
    name: 'disabled',
    isConfigured(): boolean {
      return false;
    },
    async review(_request: AiReviewRequest): Promise<AiReviewResponse> {
      return {
        status: 'skipped',
        provider: 'disabled',
        wasUsed: false,
        message: 'AI provider is not configured. Deterministic review only.',
        additionalFindings: [],
      };
    },
  };
}
