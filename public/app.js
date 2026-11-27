import { distinguishingPrefixEnd, LETTERS, majorityLabel, MAX_SOURCE_LENGTH, parseQuestions } from './questions.js';
import { GEMINI_KEY_HEADER, isGeminiKeyInput, isOpenRouterKeyInput, OPENROUTER_KEY_HEADER } from './gemini-key.js';

const claudeOnly = document.documentElement.dataset.answerProvider === 'openrouter';
const providerNames = { gemini: 'Gemini', claude: 'Claude', gpt: 'GPT' };
const comparisonProviders = ['claude', 'gpt'];
const providers = claudeOnly ? ['claude'] : ['gemini', ...comparisonProviders];
const primaryProvider = providers[0];

const example = `Practice quiz · General science
This worksheet is for personal revision. Choose one answer for each question.

1. A tasting note describes the apples as fruity. Which option matches the note?
A. The apples are red and tasty but rotten.
B. The apples are red and fruity but rotten.
C. The apples are green and bitter.
D. The apples are yellow and sweet.

End of preview page. Continue to the remaining questions below.

2. What process do plants use to make sugars from sunlight?
A. Photosynthesis
B. Fermentation
C. Evaporation
D. Respiration

3. Which of these is a renewable source of energy?
A. Coal
B. Natural gas
C. Wind
D. Petroleum`;

const exampleAnswers = [
  { id: 'q1', choice: 'B', explanation: 'The tasting note describes the apples as fruity.' },
  { id: 'q2', choice: 'A', explanation: 'Plants use sunlight to produce sugars through photosynthesis.' },
  { id: 'q3', choice: 'C', explanation: 'Wind is replenished by natural atmospheric processes.' },
];

const ids = [
  'paste-form', 'source', 'exclusions', 'source-count', 'load-example', 'review', 'clear',
  'step-paste', 'step-review', 'step-answers', 'review-title', 'review-description',
  'empty-state', 'review-actions', 'review-content', 'result-summary', 'issues', 'question-list',
  'answer', 'answer-label', 'answer-note', 'copy', 'status',
  'workspace', 'manage-key', 'key-dialog', 'key-title', 'key-description', 'key-form',
  'remove-key', 'cancel-key', 'save-key',
];
const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
const keyInputs = Object.fromEntries(providers.map((provider) => [provider, document.getElementById(`${provider}-key-input`)]));
const results = new Map();
let review = null;
let pending = null;
let apiKeys = {};

function element(tag, content, className) {
  const node = document.createElement(tag);
  if (content) node.textContent = content;
  if (className) node.className = className;
  return node;
}

function announce(message = '', isError = false) {
  ui.status.textContent = message;
  ui.status.classList.toggle('is-error', isError);
}

function plural(count, word) {
  return `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`;
}

function isExample() {
  return !claudeOnly && ui.source.value.trim() === example && !ui.exclusions.value.trim();
}

function hasKeys() {
  return providers.every((provider) => apiKeys[provider]);
}

function selectedOptions(answer) {
  return answer?.choices ?? (LETTERS.includes(answer?.choice) ? [answer.choice] : []);
}

function questionCard(question, answer, comparisons) {
  const card = element('li', '', 'question-card');
  const heading = element('h3');
  heading.append(element('span', `${question.number}.`, 'question-number'), element('span', question.stem));
  const options = element('ul', '', 'option-list');
  const selected = selectedOptions(answer);

  for (const letter of LETTERS) {
    const option = element('li', '', 'option');
    option.dataset.letter = letter;
    const wording = question.options[letter];
    const text = element('span', wording, 'option-text');
    option.append(element('strong', letter, 'option-label'), text);
    if (selected.includes(letter)) {
      const alternatives = LETTERS.filter((other) => other !== letter).map((other) => question.options[other]);
      const end = distinguishingPrefixEnd(wording, alternatives);
      text.replaceChildren(element('mark', wording.slice(0, end), 'answer-highlight'), wording.slice(end));
      option.classList.add('is-answer');
      option.append(element('span', 'Answer', 'option-answer'));
    }
    options.append(option);
  }

  card.append(heading, options);
  if (answer?.choice === 'UNANSWERABLE') card.append(element('p', 'Unanswered', 'explanation unanswered'));
  if (answer?.explanation) card.append(element('p', answer.explanation, 'explanation'));
  if (comparisons.length) {
    const line = element('p', '', 'model-comparisons');
    const selections = answer ? [selected] : [];
    for (const [index, { provider, byId, unavailable }] of comparisons.entries()) {
      const comparison = byId.get(question.id);
      const letters = selectedOptions(comparison);
      if (comparison) selections.push(letters);
      const choice = letters.join(', ') || (unavailable ? 'Unavailable' : comparison ? '—' : '…');
      const item = element('span');
      item.append(`${providerNames[provider]} `, element('strong', choice));
      if (index) line.append(' · ');
      line.append(item);
    }
    const majority = pending ? '' : majorityLabel(selections);
    if (majority) line.append(' · ', element('strong', majority, 'majority-answer'));
    card.append(line);
  }
  return card;
}

function render() {
  const answers = results.get(primaryProvider)?.answers;
  const allReady = providers.every((provider) => results.get(provider)?.answers);
  const exampleLoaded = isExample();
  const step = answers ? 'answers' : review ? 'review' : 'paste';
  for (const name of ['paste', 'review', 'answers']) {
    if (name === step) ui[`step-${name}`].setAttribute('aria-current', 'step');
    else ui[`step-${name}`].removeAttribute('aria-current');
  }

  ui['source-count'].textContent = plural(ui.source.value.length, 'character');
  ui.workspace.inert = !hasKeys();
  ui['manage-key'].disabled = !hasKeys();
  ui.review.disabled = !ui.source.value.trim();
  ui.clear.disabled = !ui.source.value && !ui.exclusions.value;
  ui['empty-state'].hidden = Boolean(review);
  ui['review-actions'].hidden = allReady || (exampleLoaded && Boolean(answers));
  ui['review-content'].hidden = !review;
  ui.copy.hidden = !answers;
  ui['review-title'].textContent = answers ? 'Answer key' : 'Question preview';
  ui['review-description'].textContent = answers
    ? exampleLoaded ? 'Example answers' : `Generated by ${providerNames[primaryProvider]}`
    : 'Review your cleaned list before answering.';
  const canAnswer = review?.questions.length && !review.warnings.length;
  ui.answer.disabled = !hasKeys() || !canAnswer || allReady || (exampleLoaded && Boolean(answers)) || Boolean(pending);
  ui['answer-label'].textContent = pending ? 'Getting answers…' : exampleLoaded ? 'Show example answers'
    : results.size ? 'Retry missing answers' : 'Get answers';
  ui['review-content'].setAttribute('aria-busy', String(Boolean(pending)));
  ui['answer-note'].textContent = 'Review the list to continue.';
  if (!review) return;

  if (review.warnings.length) ui['answer-note'].textContent = 'Resolve the review notes to continue.';
  else if (exampleLoaded) ui['answer-note'].textContent = 'Uses built-in example answers.';
  else if (pending) ui['answer-note'].textContent = 'Sending questions in small groups.';
  else ui['answer-note'].textContent = claudeOnly ? 'Uses your OpenRouter key.' : 'Uses your Gemini key and OpenRouter credits.';
  ui['result-summary'].textContent = plural(review.questions.length, 'question');
  if (review.removed.length) ui['result-summary'].textContent += ` · ${plural(review.removed.length, 'paragraph')} removed`;
  ui.issues.hidden = !review.warnings.length;
  ui.issues.replaceChildren(...review.warnings.map((issue) => element('li', issue)));

  const byId = new Map(answers?.map((answer) => [answer.id, answer]));
  const comparisons = claudeOnly || exampleLoaded || !results.size ? [] : comparisonProviders.map((provider) => {
    const outcome = results.get(provider);
    return { provider, byId: new Map(outcome?.answers?.map((answer) => [answer.id, answer])), unavailable: Boolean(outcome?.error) };
  });
  ui['question-list'].replaceChildren(...review.questions.map((question) => questionCard(question, byId.get(question.id), comparisons)));
}

function cancelPendingAnswer() {
  pending?.abort();
  pending = null;
  for (const [provider, outcome] of results) {
    if (outcome.loading) results.delete(provider);
  }
}

function invalidateReview() {
  cancelPendingAnswer();
  review = null;
  results.clear();
  announce();
  render();
}

function openKeyDialog() {
  const dialog = ui['key-dialog'];
  const unlocked = hasKeys();
  dialog.setAttribute('closedby', unlocked ? 'closerequest' : 'none');
  for (const [provider, input] of Object.entries(keyInputs)) {
    input.value = '';
    input.required = !apiKeys[provider];
    input.setCustomValidity('');
  }
  ui['key-description'].textContent = unlocked
    ? 'Leave a field blank to keep its current key.'
    : 'Add your keys to continue. Learnt keeps them in this tab until you refresh or remove them.';
  ui['remove-key'].hidden = !unlocked;
  ui['cancel-key'].hidden = !unlocked;
  ui['save-key'].textContent = unlocked ? 'Save keys' : 'Continue';
  if (!dialog.open) dialog.showModal();
  keyInputs[primaryProvider].focus();
}

function setApiKeys(next) {
  if (providers.some((provider) => apiKeys[provider] !== next[provider])) cancelPendingAnswer();
  apiKeys = next;
  render();
}

ui.source.maxLength = MAX_SOURCE_LENGTH;
ui.source.addEventListener('input', invalidateReview);
ui.exclusions.addEventListener('input', invalidateReview);

ui['manage-key'].addEventListener('click', openKeyDialog);
for (const input of Object.values(keyInputs)) input.addEventListener('input', () => input.setCustomValidity(''));
ui['cancel-key'].addEventListener('click', () => ui['key-dialog'].close());
ui['key-dialog'].addEventListener('cancel', (event) => {
  if (!hasKeys()) event.preventDefault();
});
ui['key-dialog'].addEventListener('close', () => {
  if (ui['key-dialog'].open) return;
  if (!hasKeys()) openKeyDialog();
  else for (const input of Object.values(keyInputs)) input.value = '';
});
ui['remove-key'].addEventListener('click', () => {
  setApiKeys({});
  announce();
  openKeyDialog();
});
ui['key-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  const next = { ...apiKeys };
  for (const [provider, input] of Object.entries(keyInputs)) {
    const key = input.value.trim();
    if (!key && next[provider]) continue;
    const valid = provider === 'gemini' ? isGeminiKeyInput(key) : isOpenRouterKeyInput(key);
    if (!valid) {
      const keyName = provider === 'gemini' ? 'Gemini API key' : 'OpenRouter API key';
      input.setCustomValidity(`Paste a valid ${keyName} without spaces.`);
      input.reportValidity();
      return;
    }
    next[provider] = key;
  }
  const unlocking = !hasKeys();
  setApiKeys(next);
  ui['key-dialog'].close();
  if (unlocking) ui.source.focus();
  announce(claudeOnly ? 'OpenRouter key saved for this tab.' : 'API keys saved for this tab.');
});

ui['load-example'].addEventListener('click', () => {
  ui.source.value = example;
  ui.exclusions.value = '';
  invalidateReview();
  ui.source.focus();
  announce('Example loaded. Select Review questions to continue.');
});

ui.clear.addEventListener('click', () => {
  ui.source.value = '';
  ui.exclusions.value = '';
  invalidateReview();
  ui.source.focus();
});

ui['paste-form'].addEventListener('submit', (event) => {
  event.preventDefault();
  if (!ui.source.value.trim()) return;
  cancelPendingAnswer();
  review = parseQuestions(ui.source.value, ui.exclusions.value);
  results.clear();
  render();
  ui['review-title'].focus();
  const message = `${plural(review.questions.length, 'question')} found. ${plural(review.removed.length, 'paragraph')} removed.`;
  announce(review.warnings.length ? `${message} Check the review notes.` : message);
});

async function requestAnswers() {
  if (!hasKeys() || !review?.questions.length || review.warnings.length || pending) return;
  if (isExample()) {
    results.set(primaryProvider, { answers: exampleAnswers });
    render();
    announce('Example answer key ready.');
    return;
  }

  const remaining = providers.filter((provider) => !results.get(provider)?.answers);
  if (!remaining.length) return;
  const request = new AbortController();
  pending = request;
  const questions = review.questions.map(({ id, stem, options }) => ({ id, stem, options }));
  const body = JSON.stringify({ questions });
  for (const provider of remaining) results.set(provider, { loading: true });
  render();
  announce(`Getting answers from ${remaining.map((provider) => providerNames[provider]).join(', ')}.`);
  await Promise.all(remaining.map(async (provider) => {
    let outcome;
    try {
      const header = provider === 'gemini' ? GEMINI_KEY_HEADER : OPENROUTER_KEY_HEADER;
      const response = await fetch(`/api/answers?provider=${provider}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', [header]: apiKeys[provider] },
        body,
        signal: request.signal,
        redirect: 'error',
      });
      const result = await response.json().catch(() => null);
      if (response.ok && Array.isArray(result?.answers)) outcome = { answers: result.answers };
      else outcome = { error: result?.error || `Could not get answers (HTTP ${response.status}). Try again.` };
    } catch {
      outcome = { error: 'Could not reach the answer service. Try again.' };
    }
    if (pending !== request) return;
    results.set(provider, outcome);
    render();
  }));
  if (pending !== request) return;
  pending = null;
  const errors = providers.flatMap((provider) => {
    const error = results.get(provider)?.error;
    return error ? [`${providerNames[provider]} · ${error}`] : [];
  });
  announce(errors.length ? errors.join(' ') : `Answer key ready for ${plural(questions.length, 'question')}.`, Boolean(errors.length));
  render();
}

ui.answer.addEventListener('click', requestAnswers);

ui.copy.addEventListener('click', async () => {
  const answers = results.get(primaryProvider)?.answers;
  if (!answers) return;
  const byId = new Map(answers.map((answer) => [answer.id, answer]));
  const key = review.questions.map(({ id, number, options }) => {
    const wording = selectedOptions(byId.get(id)).map((choice) => `${choice}. ${options[choice]}`).join('\n   ');
    return `${number}. ${wording || 'Unanswered'}`;
  }).join('\n');
  try {
    await navigator.clipboard.writeText(key);
    announce('Answer key copied.');
  } catch {
    announce('Clipboard access is unavailable in this browser.', true);
  }
});

if (claudeOnly) {
  ui['manage-key'].textContent = 'OpenRouter key';
  ui['key-title'].textContent = 'Claude OpenRouter key';
  ui['remove-key'].textContent = 'Remove key';
  for (const provider of ['gemini', 'gpt']) {
    document.getElementById(`${provider}-key-field`).hidden = true;
    document.getElementById(`${provider}-key-input`).disabled = true;
  }
}
render();
openKeyDialog();
