# Learnt

Learnt turns pasted multiple-choice questions into a reviewed, colour-coded answer key. It preserves original question numbers, stems, and option order.

## Run locally

Use Node.js 22 or later. Start the app with `npm start` and open [Learnt on localhost](http://127.0.0.1:3000/).

Enter your Gemini API key in the startup prompt to unlock the workspace. You can replace or remove the key from **Gemini key** in the header. Removing it locks the workspace again. After unlocking, **Load example** uses built-in answers. See [Google’s Gemini API key guide](https://ai.google.dev/gemini-api/docs/api-key).

The server uses `gemini-3.8-flash` by default. Set `GEMINI_MODEL` in the same session to use a different model that supports structured output. See [the Gemini model list](https://ai.google.dev/gemini-api/docs/models).

## Review and answer

1. Paste up to 50 questions with four options each. Labels A through D are optional for numbered questions when the question text and each option are separated by blank lines. Repeated headers like `1.` followed by `Question 1` count as one question.
2. Select **Review questions**. For numbered input, Learnt treats text above the first question and separate paragraphs after option D as surrounding material. Check the removed paragraphs in the preview. Keep any passage a question needs within that question’s stem. Use **Exclude specific paragraphs** to remove any other complete, blank-line-delimited paragraphs by exact text.
3. Select **Get answers** to send the reviewed question stems and options to Gemini. The answer key highlights each selected option and includes a brief explanation. Questions marked “Select all that apply” can have multiple answers. Questions without sufficient context can appear as **Unanswered**. Use **Copy key** for a compact list.

Question cleanup runs in the browser. Learnt keeps the key in tab memory until you refresh or remove it. The local server forwards it to Gemini with each answer request. Usage draws on the Google project associated with the key. Learnt doesn't save the pasted text or answer key between sessions.

## Tests

Run `npm test`. The suite checks question cleanup and the local answer endpoint with a mocked Gemini response.
