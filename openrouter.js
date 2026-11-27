import { GeminiError as AnswerError, letterAnswerSchema, letterInstruction, parseAnswerText, plainQuestionBatches } from './gemini.js';

const models = new Map([
  ['claude', 'anthropic/claude-haiku-5.5'],
  ['gpt', 'openai/gpt-6-sol'],
]);
const endpoint = 'https://openrouter.ai/api/v1/chat/completions';
const answersProperty = letterAnswerSchema.properties.answers;
const strictAnswerSchema = {
  ...letterAnswerSchema,
  additionalProperties: false,
  properties: {
    answers: { ...answersProperty, items: { ...answersProperty.items, additionalProperties: false } },
  },
};

function upstreamError(status) {
  if (status === 401 || status === 403) return new AnswerError(403, 'OpenRouter rejected access. Check your API key and its permissions.');
  if (status === 402) return new AnswerError(402, 'OpenRouter has insufficient credits for this request. Check your balance and key limit.');
  if (status === 429) return new AnswerError(429, 'OpenRouter hit a rate limit. Try again shortly.');
  if (status === 408 || status === 504) return new AnswerError(504, 'The model took too long to answer. Try a smaller batch.');
  if (status === 404 || status >= 500) return new AnswerError(503, 'The model is temporarily unavailable through OpenRouter. Try again shortly.');
  return new AnswerError(502, `OpenRouter rejected the request (HTTP ${status}).`);
}

function invalidResponse() {
  return new AnswerError(502, 'The model returned an incomplete answer key. Try again with fewer questions.');
}

async function answerBatch(questions, { apiKey, fetcher, signal, model }) {
  signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(50_000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let payload;
  try {
    const response = await fetcher(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      redirect: 'error',
      signal: requestSignal,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: letterInstruction },
          { role: 'user', content: JSON.stringify({ questions }) },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: { name: 'quiz_answers', strict: true, schema: strictAnswerSchema },
        },
        provider: { require_parameters: true },
        reasoning: { effort: 'low' },
        max_tokens: 2048,
      }),
    });
    if (!response.ok) throw upstreamError(response.status);
    payload = await response.json();
  } catch (error) {
    if (error instanceof AnswerError) throw error;
    if (timeout.aborted || error?.name === 'TimeoutError' || error?.cause?.code === 'UND_ERR_CONNECT_TIMEOUT') throw upstreamError(504);
    if (error instanceof SyntaxError) throw invalidResponse();
    throw new AnswerError(502, 'Could not read a response from OpenRouter. Try again.');
  }

  if (payload?.error) {
    const status = Number(payload.error.code);
    throw upstreamError(Number.isInteger(status) && status >= 400 && status <= 599 ? status : 502);
  }
  const choice = payload?.choices?.[0];
  if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
    throw new AnswerError(422, 'The model declined to answer these questions. Review the question text before trying again.');
  }
  if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') throw invalidResponse();
  return parseAnswerText(choice.message.content, questions, invalidResponse);
}

export async function answerWithOpenRouter(questions, { provider, ...options }) {
  const model = models.get(provider);
  if (!model) throw new AnswerError(400, 'Choose Claude or GPT.');
  const answers = [];
  for (const batch of plainQuestionBatches(questions)) {
    answers.push(...await answerBatch(batch, { ...options, model }));
  }
  return answers;
}
