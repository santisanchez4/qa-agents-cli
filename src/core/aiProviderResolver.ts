import { AiProvider, createDisabledAiProvider } from './aiProvider';
import { createOpenAiProvider }    from './providers/openAiProvider';
import { createAnthropicProvider } from './providers/anthropicProvider';
import { createGeminiProvider }    from './providers/geminiProvider';
import { createDeepSeekProvider }  from './providers/deepSeekProvider';

const DEFAULTS = {
  openai:    'gpt-4.1-mini',
  anthropic: 'claude-sonnet-4-5',
  gemini:    'gemini-2.5-flash',
  deepseek:  'deepseek-v4-flash',
} as const;

export function resolveAiProvider(): AiProvider {
  const providerName = process.env['QA_AGENTS_AI_PROVIDER'];

  if (providerName === 'openai') {
    const apiKey = process.env['OPENAI_API_KEY'];
    if (apiKey) {
      const model = process.env['QA_AGENTS_OPENAI_MODEL'] || DEFAULTS.openai;
      return createOpenAiProvider(apiKey, model);
    }
  }

  if (providerName === 'anthropic') {
    const apiKey = process.env['ANTHROPIC_API_KEY'];
    if (apiKey) {
      const model = process.env['QA_AGENTS_ANTHROPIC_MODEL'] || DEFAULTS.anthropic;
      return createAnthropicProvider(apiKey, model);
    }
  }

  if (providerName === 'gemini') {
    const apiKey = process.env['GEMINI_API_KEY'];
    if (apiKey) {
      const model = process.env['QA_AGENTS_GEMINI_MODEL'] || DEFAULTS.gemini;
      return createGeminiProvider(apiKey, model);
    }
  }

  if (providerName === 'deepseek') {
    const apiKey = process.env['DEEPSEEK_API_KEY'];
    if (apiKey) {
      const model = process.env['QA_AGENTS_DEEPSEEK_MODEL'] || DEFAULTS.deepseek;
      return createDeepSeekProvider(apiKey, model);
    }
  }

  return createDisabledAiProvider();
}
