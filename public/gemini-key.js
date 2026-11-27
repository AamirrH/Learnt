export const GEMINI_KEY_HEADER = 'x-goog-api-key';
export const OPENROUTER_KEY_HEADER = 'x-openrouter-api-key';

function isKeyInput(value) {
  return typeof value === 'string' && /^[!-~]{1,512}$/.test(value) && !value.includes(',');
}

export function isGeminiKeyInput(value) {
  return isKeyInput(value) && !/^sk-or-v1-/i.test(value);
}

export function isOpenRouterKeyInput(value) {
  return isKeyInput(value) && /^sk-or-v1-[a-z\d_-]+$/i.test(value);
}
