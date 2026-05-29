import OpenAI from 'openai';
import { AiProvider, AiReviewRequest, AiReviewResponse, REVIEW_SYSTEM_MESSAGE, safeErrorMessage } from '../aiProvider';

export function createOpenAiProvider(apiKey: string, model: string): AiProvider {
  return {
    name: 'openai',
    isConfigured(): boolean {
      return true;
    },
    async review(request: AiReviewRequest): Promise<AiReviewResponse> {
      try {
        const client = new OpenAI({ apiKey });
        const completion = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: REVIEW_SYSTEM_MESSAGE },
            { role: 'user',   content: request.prompt },
          ],
          max_tokens: 1500,
        });

        const content = completion.choices[0]?.message?.content?.trim() ?? '';

        return {
          status: 'completed',
          provider: 'openai',
          model,
          content,
          wasUsed: true,
          message: 'AI review completed.',
          additionalFindings: [],
        };
      } catch (err) {
        return {
          status: 'error',
          provider: 'openai',
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
