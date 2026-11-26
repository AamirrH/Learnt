import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createApp } from '../server.js';

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
    apiKey: 'mock-key',
    fetcher(url, options) {
      upstream = { url, ...options, body: JSON.parse(options.body) };
      return providerResponse([...expected].reverse());
    },
  });

  const response = await post({ questions, removed: ['Do not send this paragraph.'] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { answers: expected });
  assert.match(upstream.url, /^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\/.+:generateContent$/);
  assert.equal(upstream.headers['x-goog-api-key'], 'mock-key');
  assert.deepEqual(JSON.parse(upstream.body.contents[0].parts[0].text), {
    questions: questions.map(({ id, stem, options }) => ({ id, stem, options })),
  });
  assert.deepEqual(upstream.body.generationConfig.responseJsonSchema.properties.answers.items.properties.choice.enum,
    ['A', 'B', 'C', 'D', 'UNANSWERABLE']);
});

test('rejects duplicate Gemini answers so one question cannot receive another answer', async (t) => {
  const answer = { id: 'q1', choice: 'B', explanation: 'Example.' };
  const post = await startApi(t, { apiKey: 'mock-key', fetcher: () => providerResponse([answer, answer]) });
  const response = await post({ questions });
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /incomplete answer key/);
});

test('rejects invalid requests and reports a missing key without calling Gemini', async (t) => {
  const fetcher = t.mock.fn();
  const post = await startApi(t, { apiKey: '', fetcher });
  assert.equal((await post({ questions }, { Origin: 'https://different.example' })).status, 403);
  assert.equal((await post({ questions: [questions[0], questions[0]] })).status, 400);
  const response = await post({ questions });
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /GEMINI_API_KEY/);
  assert.equal(fetcher.mock.callCount(), 0);
});
