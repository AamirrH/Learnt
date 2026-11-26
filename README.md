# Learnt

Learnt turns pasted multiple-choice questions into a reviewed, colour-coded answer key. It preserves original question numbers, stems, and option order.

## Run locally

Use Node.js 22 or later. Start the app with `npm start` and open [Learnt on localhost](http://127.0.0.1:3000/).

Enter your Gemini API key in the startup prompt to unlock the workspace. You can replace or remove the key from **Gemini key** in the header. Removing it locks the workspace again. After unlocking, **Load example** uses built-in answers. See [Google’s Gemini API key guide](https://ai.google.dev/gemini-api/docs/api-key).

The server starts with `gemini-3.5-flash-lite`. If it times out or is unavailable, Learnt tries `gemini-3.8-flash` once and uses it for the remaining groups in that request. Set `GEMINI_MODEL` in the same session to choose a different starting model with structured output support. See [the Gemini model list](https://ai.google.dev/gemini-api/docs/models).

## Review and answer

1. Paste up to 50 questions with four options each. Labels A through D are optional for numbered questions when the question text and each option are separated by blank lines. Repeated headers like `1.` followed by `Question 1` count as one question.
2. Select **Review questions**. Learnt strips surrounding page text and common quiz interface prompts. The preview shows a removal count alongside the cleaned questions and options. Keep passages a question needs within its stem. Use **Exclude specific paragraphs** for other complete, blank-line-delimited passages. Learnt matches prose across changes in spacing and line wrapping.
3. Select **Get answers** to send the reviewed question stems and options to Gemini as plain text in JSON. Learnt splits longer lists into small groups automatically and combines the results in the original order. The answer key highlights each selected option and includes a brief explanation. Questions marked “Select all that apply” can have multiple answers. Questions without sufficient context can appear as **Unanswered**. Use **Copy key** for a compact list.

Question cleanup runs in the browser. Learnt keeps the key in tab memory until you refresh or remove it. The local server forwards it to Gemini with each answer request. Usage draws on the Google project associated with the key. Learnt doesn't save the pasted text or answer key between sessions.

Code fenced with triple backticks or tildes, or indented with four spaces or a tab, keeps its indentation and blank lines. Use A–D labels when options have several paragraphs or consecutive indented snippets.

## Tests

Run `npm test`. The suite checks question cleanup and the local answer endpoint with a mocked Gemini response.
