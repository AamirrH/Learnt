# Learnt

Learnt turns pasted multiple-choice questions into a reviewed, colour-coded answer key. It preserves original question numbers, stems, and option order.

## Run locally

Use Node.js 22 or later. Start the app with `npm start` and open [Learnt on localhost](http://127.0.0.1:3000/). The **Load example** button works with built-in answers.

For answers to your own questions, start the server from a PowerShell session with your Gemini API key in its environment. The prompt masks the key as you type. See [Google’s Gemini API key guide](https://ai.google.dev/gemini-api/docs/api-key).

```powershell
$env:GEMINI_API_KEY = Read-Host -MaskInput 'Gemini API key'
npm start
```

The server uses `gemini-3.8-flash` by default. Set `GEMINI_MODEL` in the same session to use a different model that supports structured output. See [the Gemini model list](https://ai.google.dev/gemini-api/docs/models).

## Review and answer

1. Paste up to 50 questions with four options labeled A through D. Use numbered questions throughout, or put a blank line between each unnumbered question.
2. Select **Review questions**. For numbered input, Learnt treats text above the first question and separate paragraphs after option D as surrounding material. Check the removed paragraphs in the preview. Keep any passage a question needs within that question’s stem. Use **Exclude specific paragraphs** to remove any other complete, blank-line-delimited paragraphs by exact text.
3. Select **Get answers** to send the reviewed question stems and options to Gemini. The answer key highlights the selected option and includes a brief explanation. Questions without sufficient context can appear as **Unanswered**. Use **Copy key** for a compact list.

Question cleanup runs in the browser. The local server sends requests to Gemini using its environment key. Learnt doesn't save the pasted text or answer key between sessions.

## Tests

Run `npm test`. The suite checks question cleanup and the local answer endpoint with a mocked Gemini response.
