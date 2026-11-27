import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { answerWithGemini, DEFAULT_MODEL, GeminiError } from './gemini.js';
import { answerWithOpenRouter } from './openrouter.js';
import { GEMINI_KEY_HEADER, isGeminiKeyInput, isOpenRouterKeyInput, OPENROUTER_KEY_HEADER } from './public/gemini-key.js';
import { LETTERS, MAX_QUESTIONS, MAX_SOURCE_LENGTH } from './public/questions.js';

const MAX_REQUEST_BYTES = 400 * 1024;
const localHost = /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i;

const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']],
  ['/gemini-key.js', ['gemini-key.js', 'text/javascript; charset=utf-8']],
  ['/questions.js', ['questions.js', 'text/javascript; charset=utf-8']],
]);

function sendJson(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  }).end(JSON.stringify(body));
}

async function readQuestions(request) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request.iterator({ destroyOnReturn: false })) {
    bytes += chunk.length;
    if (bytes > MAX_REQUEST_BYTES) {
      request.resume();
      throw new GeminiError(413, 'This batch is too large. Try a smaller batch.');
    }
    chunks.push(chunk);
  }
  let body;
  try {
    body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new GeminiError(400, 'Send the questions as valid JSON.');
  }

  if (!Array.isArray(body?.questions) || !body.questions.length || body.questions.length > MAX_QUESTIONS) {
    throw new GeminiError(400, `Send between 1 and ${MAX_QUESTIONS} reviewed questions.`);
  }
  const seen = new Set();
  let characters = 0;
  return body.questions.map((question) => {
    const { id, stem, options } = question ?? {};
    if (typeof id !== 'string' || !/^q\d{1,5}$/.test(id) || seen.has(id)
      || typeof stem !== 'string' || !stem.trim() || !options
      || LETTERS.some((letter) => typeof options[letter] !== 'string' || !options[letter].trim())) {
      throw new GeminiError(400, 'Each question needs a unique ID, question text, and four options labeled A through D.');
    }
    seen.add(id);
    characters += stem.length + LETTERS.reduce((length, letter) => length + options[letter].length, 0);
    if (characters > MAX_SOURCE_LENGTH) throw new GeminiError(413, 'This batch is too large. Try a smaller batch.');
    return { id, stem, options: Object.fromEntries(LETTERS.map((letter) => [letter, options[letter]])) };
  });
}

async function handleAnswers(request, response, { model, fetcher, defaultProvider }, publicOrigin) {
  const host = request.headers.host;
  const origin = request.headers.origin;
  const allowedOrigin = publicOrigin
    ? origin === publicOrigin && `https://${host}` === publicOrigin
    : localHost.test(host) && (!origin || origin === `http://${host}`);
  if (!allowedOrigin) {
    sendJson(response, 403, { error: 'Open Learnt from its configured address to request answers.' });
    return;
  }
  if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    sendJson(response, 415, { error: 'Send the questions as JSON.' });
    return;
  }

  const params = new URLSearchParams(request.url.split('?', 2)[1]);
  const provider = params.get('provider') ?? defaultProvider;
  if (provider !== null && !['gemini', 'claude', 'gpt'].includes(provider)) {
    sendJson(response, 400, { error: 'Choose Gemini, Claude, or GPT.' });
    return;
  }
  const openRouter = provider === 'claude' || provider === 'gpt';

  const controller = new AbortController();
  response.on('close', () => {
    if (!response.writableEnded) controller.abort();
  });
  try {
    const questions = await readQuestions(request);
    const apiKey = request.headers[openRouter ? OPENROUTER_KEY_HEADER : GEMINI_KEY_HEADER];
    if (!(openRouter ? isOpenRouterKeyInput(apiKey) : isGeminiKeyInput(apiKey))) {
      const keyProvider = openRouter ? 'OpenRouter' : 'Gemini';
      throw new GeminiError(400, `Add your ${keyProvider} API key to request answers.`);
    }
    const config = { fetcher, apiKey, signal: controller.signal };
    const answers = openRouter
      ? await answerWithOpenRouter(questions, { ...config, provider })
      : await answerWithGemini(questions, { ...config, model, lettersOnly: provider === 'gemini' });
    sendJson(response, 200, { answers });
  } catch (error) {
    if (response.destroyed) return;
    if (error instanceof GeminiError) sendJson(response, error.status, { error: error.message });
    else sendJson(response, 500, { error: 'Could not answer the questions. Try again.' });
  }
}

export function createAnswerHandler({ model = process.env.GEMINI_MODEL || DEFAULT_MODEL, fetcher = fetch, publicOrigin, openRouter = false } = {}) {
  const defaultProvider = openRouter && !publicOrigin ? 'claude' : null;
  return async (request, response) => {
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'POST');
      sendJson(response, 405, { error: 'Send a POST request to request answers.' });
      return;
    }
    await handleAnswers(request, response, { model, fetcher, defaultProvider }, publicOrigin);
  };
}

export function createApp(options = {}) {
  const answer = createAnswerHandler(options);
  return createServer(async (request, response) => {
    const path = request.url.split('?', 1)[0];
    if (path === '/api/answers' && request.method === 'POST') {
      await answer(request, response);
      return;
    }
    const asset = request.method === 'GET' && assets.get(path);
    if (!asset) {
      response.writeHead(404).end('Not found');
      return;
    }

    try {
      const [file, contentType] = asset;
      const body = await readFile(new URL(`./public/${file}`, import.meta.url));
      const content = options.openRouter && !options.publicOrigin && path === '/'
        ? body.toString().replace('<html lang="en">', '<html lang="en" data-answer-provider="openrouter">')
        : body;
      response.writeHead(200, {
        'Content-Type': contentType,
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      }).end(content);
    } catch {
      response.writeHead(500).end('Could not load the workspace.');
    }
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const openRouter = process.argv.includes('--openrouter');
  const port = Number(process.env.PORT || (openRouter ? 3118 : 3000));
  createApp({ openRouter }).listen(port, '127.0.0.1', () => {
    console.log(`Learnt${openRouter ? ' with Claude via OpenRouter' : ''} is available at http://127.0.0.1:${port}`);
  });
}
