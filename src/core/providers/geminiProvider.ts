import { AiProvider, AiReviewRequest, AiReviewResponse, REVIEW_SYSTEM_MESSAGE, safeErrorMessage } from '../aiProvider';

// @google/genai is an ESM-only package; dynamic import() is required from CJS modules.
export function createGeminiProvider(apiKey: string, model: string): AiProvider {
  return {
    name: 'gemini',
    isConfigured(): boolean {
      return true;
    },
    async review(request: AiReviewRequest): Promise<AiReviewResponse> {
      try {
        const { GoogleGenAI } = await import('@google/genai');
        const ai = new GoogleGenAI({ apiKey });
        const response = await ai.models.generateContent({
          model,
          contents: request.prompt,
          config: {
            systemInstruction: REVIEW_SYSTEM_MESSAGE,
            maxOutputTokens: 1500,
          },
        });

        const content = (response.text ?? '').trim();

        return {
          status: 'completed',
          provider: 'gemini',
          model,
          content,
          wasUsed: true,
          message: 'AI review completed.',
          additionalFindings: [],
        };
      } catch (err) {
        return {
          status: 'error',
          provider: 'gemini',
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
