import { AiProvider, createDisabledAiProvider } from './aiProvider';

// Step 33+: add real provider factories here.
// Read ANTHROPIC_API_KEY / OPENAI_API_KEY from process.env,
// instantiate the matching provider, and return it.
// The disabled provider must always remain the safe fallback.

export function resolveAiProvider(): AiProvider {
  return createDisabledAiProvider();
}
