import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../server.js';
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
  assert.deepEqual(upstream.body.generationConfig.responseJsonSchema.properties.answers.items.properties.choices.items.enum,
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
