# Learnt

Learnt turns pasted multiple-choice questions into a reviewed, colour-coded answer key. It preserves original question numbers, stems, and option order.

## Run locally

Use Node.js 22 or later. Start the app with `npm start` and open [Learnt on localhost](http://127.0.0.1:3000/).

Enter a Gemini API key and separate Claude and GPT OpenRouter keys in the startup prompt. You can use the same OpenRouter key in both fields. **API keys** in the header lets you replace a key or remove all keys for the tab. **Load example** uses built-in answers. See [Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key) and [OpenRouter API keys](https://openrouter.ai/settings/keys).

The server starts with `gemini-3.5-flash-lite`. If it times out or is unavailable, Learnt tries `gemini-3.8-flash` once and uses it for the remaining groups in that request. Set `GEMINI_MODEL` in the same session to choose a different starting model with structured output support. See [the Gemini model list](https://ai.google.dev/gemini-api/docs/models).

OpenRouter compares Claude Sonnet 5.5 and GPT-6 Sol through its Chat Completions endpoint. Both use low reasoning effort to keep the answer requests short. To test just Claude locally, run `npm run start:claude` and open [Claude mode](http://127.0.0.1:3118/).

## Review and answer

1. Paste up to 100 questions with four options each. Labels A through D are optional for numbered questions when the question text and each option are separated by blank lines. Repeated headers like `1.` followed by `Question 1` count as one question.
2. Select **Review questions**. Learnt strips surrounding page text and common quiz interface prompts. The preview shows a removal count alongside the cleaned questions and options. Keep passages a question needs within its stem. Use **Exclude specific paragraphs** for other complete, blank-line-delimited passages. Learnt matches prose across changes in spacing and line wrapping.
3. Select **Get answers** to send the same reviewed question stems and options to all three models as plain text in JSON. Learnt sends batches of up to 20 in order and displays each batch as it comes back. Claude’s and GPT’s letters appear below Gemini’s highlighted selections. When models disagree, Learnt shows a majority if two models pick the same complete set of options. If a model fails, the other models continue. **Retry missing answers** resumes that model at its first unfinished batch. Use **Copy key** for Gemini’s compact answer key.

Question cleanup runs in the browser. Learnt keeps keys in tab memory until you refresh or remove them. Each answer request uses the key for its selected model. Gemini usage draws on your Google project, and Claude and GPT usage draws on your OpenRouter credits.

Code fenced with triple backticks or tildes, or indented with four spaces or a tab, keeps its indentation and blank lines. Use A–D labels when options have several paragraphs or consecutive indented snippets.

## Tests

Run `npm test`. The suite checks question cleanup and the answer endpoint with mocked provider responses.
