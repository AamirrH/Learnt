export const GEMINI_KEY_HEADER = 'x-goog-api-key';

export function isGeminiKeyInput(value) {
  return typeof value === 'string' && /^[!-~]{1,512}$/.test(value) && !value.includes(',');
}
