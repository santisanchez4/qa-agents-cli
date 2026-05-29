import Anthropic from '@anthropic-ai/sdk';
import { AiProvider, AiReviewRequest, AiReviewResponse, REVIEW_SYSTEM_MESSAGE, safeErrorMessage } from '../aiProvider';

export function createAnthropicProvider(apiKey: string, model: string): AiProvider {
  return {
    name: 'anthropic',
    isConfigured(): boolean {
      return true;
    },
    async review(request: AiReviewRequest): Promise<AiReviewResponse> {
      try {
        const client = new Anthropic({ apiKey });
        const message = await client.messages.create({
          model,
          max_tokens: 1500,
          system: REVIEW_SYSTEM_MESSAGE,
          messages: [{ role: 'user', content: request.prompt }],
        });

        const content = message.content
          .map(b => b.type === 'text' ? b.text : '')
          .filter(s => s.length > 0)
          .join('\n')
          .trim();

        return {
          status: 'completed',
          provider: 'anthropic',
          model,
          content,
          wasUsed: true,
          message: 'AI review completed.',
          additionalFindings: [],
        };
      } catch (err) {
        return {
          status: 'error',
          provider: 'anthropic',
          model,
          wasUsed: false,
          message: 'AI review encountered an error.',
          errorMessage: safeErrorMessage(err),
          additionalFindings: [],
        };
      }
    },
  };
}
