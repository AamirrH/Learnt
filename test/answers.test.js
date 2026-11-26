import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../server.js';
import { DEFAULT_MODEL } from '../gemini.js';
import { GEMINI_KEY_HEADER } from '../public/gemini-key.js';

const questions = [
  { id: 'q1', number: '7', stem: 'Which planet appears red?', options: { A: 'Venus', B: 'Mars', C: 'Jupiter', D: 'Earth' } },
  { id: 'q2', number: '7', stem: 'Which material is described in the passage?', options: { A: 'Wood', B: 'Glass', C: 'Stone', D: 'Metal' } },
];

async function startApi(t, options) {
  const app = createApp(options);
  app.listen(0, '127.0.0.1');
  await once(app, 'listening');
  t.after(() => new Promise((resolve) => app.close(resolve)));
  const url = `http://127.0.0.1:${app.address().port}/api/answers`;
  return (body, headers) => fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function providerResponse(answers) {
  return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ answers }) }] } }] });
}

test('sends only reviewed questions to Gemini and matches answers by ID', async (t) => {
  const expected = [
    { id: 'q1', choice: 'B', explanation: 'Iron oxide makes Mars look red.' },
    { id: 'q2', choice: 'UNANSWERABLE', explanation: 'The referenced passage is missing.' },
  ];
  let upstream;
  const post = await startApi(t, {
    fetcher(url, options) {
      upstream = { url, ...options, body: JSON.parse(options.body) };
      return providerResponse([...expected].reverse().map(({ choice, ...answer }) => ({ ...answer, choices: [choice] })));
    },
  });

  const response = await post({ questions, removed: ['Do not send this paragraph.'] }, { [GEMINI_KEY_HEADER]: 'mock-key' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { answers: expected });
  assert.match(upstream.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
  assert.equal(upstream.headers[GEMINI_KEY_HEADER], 'mock-key');
  assert.deepEqual(JSON.parse(upstream.body.contents[0].parts[0].text), {
    questions: questions.map(({ id, stem, options }) => ({ id, stem, options })),
  });
  assert.equal(upstream.body.generationConfig.responseFormat.text.mimeType, 'APPLICATION_JSON');
  assert.deepEqual(upstream.body.generationConfig.responseFormat.text.schema.properties.answers.items.properties.choices.items.enum,
    ['A', 'B', 'C', 'D', 'UNANSWERABLE']);
});

test('sends JSON with plain-text fields while retaining code and whitespace', async (t) => {
  const question = {
    ...questions[0],
    stem: '# Which **result** does `square(2)` produce?\n\n```python\n# Keep this comment\ndef square(n):\n\n    return n ** 2\n```',
    options: { A: '*Two*', B: '~~~text\n    4\n~~~', C: '`__init__`', D: '    8' },
  };
  let upstream;
  const post = await startApi(t, { fetcher: (_url, { headers, body }) => {
    upstream = { headers, body: JSON.parse(body) };
    return providerResponse([{ id: question.id, choices: ['B'], explanation: 'The result is four.' }]);
  } });
  const response = await post({ questions: [question] }, { [GEMINI_KEY_HEADER]: 'mock-key' });
  assert.equal(response.status, 200);
  assert.equal(upstream.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(upstream.body.contents[0].parts[0].text), { questions: [{
    id: question.id,
    stem: 'Which result does square(2) produce?\n\n# Keep this comment\ndef square(n):\n\n    return n ** 2',
    options: { A: 'Two', B: '    4', C: '__init__', D: '    8' },
  }] });
});

test('rejects duplicate Gemini answers so one question cannot receive another answer', async (t) => {
  const answer = { id: 'q1', choices: ['B'], explanation: 'Example.' };
  const post = await startApi(t, { fetcher: () => providerResponse([answer, answer]) });
  const response = await post({ questions }, { [GEMINI_KEY_HEADER]: 'mock-key' });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /incomplete answer key/);
});

test('rejects invalid requests and reports a missing key without calling Gemini', async (t) => {
  const fetcher = t.mock.fn();
  const post = await startApi(t, { fetcher });
  assert.equal((await post({ questions }, { Origin: 'https://different.example' })).status, 403);
  assert.equal((await post({ questions: [questions[0], questions[0]] })).status, 400);
  const response = await post({ questions, apiKey: 'ignored-body-key' });
  assert.equal(response.status, 400);
  assert.match((await response.json()).error, /Add your Gemini API key/);
  assert.equal((await post({ questions }, { [GEMINI_KEY_HEADER]: 'invalid key' })).status, 400);
  assert.equal(fetcher.mock.callCount(), 0);
});

test('uses each caller’s key for its own answer request without retaining it', async (t) => {
  const fetcher = t.mock.fn((_url, { headers }) => {
    const choice = headers[GEMINI_KEY_HEADER] === 'mock-key-one' ? 'A' : 'B';
    return providerResponse([{ id: 'q1', choices: [choice], explanation: 'Example.' }]);
  });
  const post = await startApi(t, { fetcher });
  const payload = { questions: [questions[0]] };
  const [first, second] = await Promise.all([
    post(payload, { [GEMINI_KEY_HEADER]: 'mock-key-one' }),
    post(payload, { [GEMINI_KEY_HEADER]: 'mock-key-two' }),
  ]);
  assert.equal((await first.json()).answers[0].choice, 'A');
  assert.equal((await second.json()).answers[0].choice, 'B');
  assert.equal((await post(payload)).status, 400);
  assert.equal(fetcher.mock.callCount(), 2);
});

test('reports a rejected key without returning upstream credential details', async (t) => {
  const fetcher = () => Response.json({
    error: { message: 'Rejected mock-key', details: [{ reason: 'API_KEY_INVALID' }] },
  }, { status: 400 });
  const post = await startApi(t, { fetcher });
  const response = await post({ questions }, { [GEMINI_KEY_HEADER]: 'mock-key' });
  assert.equal(response.status, 403);
  const { error } = await response.json();
  assert.match(error, /replace it/);
  assert.doesNotMatch(error, /mock-key/);
});

test('keeps every selected option in order for select-all questions', async (t) => {
  const question = { ...questions[0], stem: 'Which planets appear in the passage? Select all that apply.' };
  const fetcher = () => providerResponse([{ id: question.id, choices: ['D', 'A', 'C'], explanation: 'All three appear.' }]);
  const post = await startApi(t, { fetcher });
  const response = await post({ questions: [question] }, { [GEMINI_KEY_HEADER]: 'mock-key' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).answers, [{ id: question.id, choices: ['A', 'C', 'D'], explanation: 'All three appear.' }]);
});

test('rejects incompatible selections for single-answer and select-all questions', async (t) => {
  let choices;
  const single = questions[0];
  const multiple = { ...single, stem: 'Which planets appear in the passage? Select all that apply.' };
  const fetcher = () => providerResponse([{ id: single.id, choices, explanation: 'Example.' }]);
  const post = await startApi(t, { fetcher });
  for (const [question, selection] of [[single, ['A', 'B']], [multiple, ['A', 'A']], [multiple, ['A', 'UNANSWERABLE']]]) {
    choices = selection;
    const response = await post({ questions: [question] }, { [GEMINI_KEY_HEADER]: 'mock-key' });
    assert.equal(response.status, 502);
  }
});

test('splits longer lists by question count and text size while preserving answer order', async (t) => {
  const input = Array.from({ length: 12 }, (_, index) => ({
    ...questions[0], id: `q${index + 1}`,
    stem: index === 10 || index === 11 ? 'Long context '.repeat(520) : questions[0].stem,
  }));
  const groups = [];
  const post = await startApi(t, { fetcher: (_url, { body }) => {
    const { questions: sent } = JSON.parse(JSON.parse(body).contents[0].parts[0].text);
    groups.push(sent.map(({ id }) => id));
    return providerResponse(sent.reverse().map(({ id }) => ({ id, choices: ['B'], explanation: 'Example.' })));
  } });
  const response = await post({ questions: input }, { [GEMINI_KEY_HEADER]: 'mock-key' });
  assert.equal(response.status, 200);
  const expected = input.map(({ id }) => id);
  assert.deepEqual(groups, [expected.slice(0, 5), expected.slice(5, 10), ['q11'], ['q12']]);
  assert.deepEqual((await response.json()).answers.map(({ id }) => id), expected);
});

test('retries only the incomplete group as two smaller requests', async (t) => {
  const input = Array.from({ length: 8 }, (_, index) => ({ ...questions[0], id: `q${index + 1}` }));
  const groups = [];
  const post = await startApi(t, { fetcher: (_url, { body }) => {
    const { questions: sent } = JSON.parse(JSON.parse(body).contents[0].parts[0].text);
    groups.push(sent.map(({ id }) => id));
    if (sent.length === 3) return Response.json({ candidates: [{ finishReason: 'MAX_TOKENS' }] });
    return providerResponse(sent.map(({ id }) => ({ id, choices: ['B'], explanation: 'Example.' })));
  } });
  const response = await post({ questions: input }, { [GEMINI_KEY_HEADER]: 'mock-key' });
  assert.equal(response.status, 200);
  const expected = input.map(({ id }) => id);
  assert.deepEqual(groups, [expected.slice(0, 5), ['q6', 'q7', 'q8'], ['q6', 'q7'], ['q8']]);
  assert.deepEqual((await response.json()).answers.map(({ id }) => id), expected);
});

test('reports upstream errors without retrying quota, unavailable service, or blocked content', async (t) => {
  let provider;
  const fetcher = t.mock.fn(() => provider());
  const post = await startApi(t, { model: 'custom-test-model', fetcher });
  const key = { [GEMINI_KEY_HEADER]: 'mock-key' };
  provider = () => Response.json({ error: { message: 'Upstream details' } }, { status: 400 });
  const rejected = await post({ questions }, key);
  assert.equal(rejected.status, 502);
  assert.match((await rejected.json()).error, /rejected the request \(HTTP 400\)/);
  provider = () => Response.json({}, { status: 429 });
  assert.equal((await post({ questions }, key)).status, 429);
  provider = () => Response.json({}, { status: 503 });
  const unavailable = await post({ questions }, key);
  assert.equal(unavailable.status, 503);
  assert.match((await unavailable.json()).error, /temporarily unavailable \(HTTP 503\)/);
  provider = () => Response.json({ promptFeedback: { blockReason: 'SAFETY' } });
  assert.equal((await post({ questions }, key)).status, 422);
  assert.equal(fetcher.mock.callCount(), 4);
});

test('switches models after a 503 and keeps the working model for the rest of the quiz', async (t) => {
  const input = Array.from({ length: 11 }, (_, index) => ({ ...questions[0], id: `q${index + 1}` }));
  const attempts = [];
  const post = await startApi(t, { model: DEFAULT_MODEL, fetcher: (url, { headers, body }) => {
    const model = url.match(/models\/([^:]+):generateContent$/)[1];
    const payload = JSON.parse(body);
    const { questions: sent } = JSON.parse(payload.contents[0].parts[0].text);
    attempts.push([model, sent[0].id, payload.generationConfig.thinkingConfig.thinkingLevel]);
    assert.equal(headers[GEMINI_KEY_HEADER], 'mock-key');
    if (model === DEFAULT_MODEL && sent[0].id === 'q6') return Response.json({}, { status: 503 });
    return providerResponse(sent.map(({ id }) => ({ id, choices: ['B'], explanation: 'Example.' })));
  } });
  const response = await post({ questions: input }, { [GEMINI_KEY_HEADER]: 'mock-key' });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).answers.map(({ id }) => id), input.map(({ id }) => id));
  assert.deepEqual(attempts, [
    [DEFAULT_MODEL, 'q1', 'MINIMAL'], [DEFAULT_MODEL, 'q6', 'MINIMAL'],
    ['gemini-3.8-flash', 'q6', 'LOW'], ['gemini-3.8-flash', 'q11', 'LOW'],
  ]);
});

test('tries the alternate after a timeout and reports both failures when it is also unavailable', async (t) => {
  const fetcher = t.mock.fn((url) => {
    if (url.includes(DEFAULT_MODEL)) throw new DOMException('Timed out', 'TimeoutError');
    return Response.json({}, { status: 503 });
  });
  const post = await startApi(t, { model: DEFAULT_MODEL, fetcher });
  const response = await post({ questions }, { [GEMINI_KEY_HEADER]: 'mock-key' });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /gemini-3\.5-flash-lite timed out.*gemini-3\.8-flash is temporarily unavailable \(HTTP 503\)/);
  assert.equal(fetcher.mock.callCount(), 2);
});

test('does not switch models on invalid credentials or quota errors', async (t) => {
  let upstreamStatus;
  const fetcher = t.mock.fn(() => Response.json({}, { status: upstreamStatus }));
  const post = await startApi(t, { model: DEFAULT_MODEL, fetcher });
  for (const status of [403, 429]) {
    upstreamStatus = status;
    assert.equal((await post({ questions }, { [GEMINI_KEY_HEADER]: 'mock-key' })).status, status);
  }
  assert.equal(fetcher.mock.callCount(), 2);
});
