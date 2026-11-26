import { LETTERS, MAX_SOURCE_LENGTH, parseQuestions } from './questions.js';

const example = `Practice quiz · General science
This worksheet is for personal revision. Choose one answer for each question.

1. Which planet is known as the Red Planet?
A. Venus
B. Mars
C. Jupiter
D. Saturn

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
  { id: 'q1', choice: 'B', explanation: 'Iron oxide on the surface gives Mars its red colour.' },
  { id: 'q2', choice: 'A', explanation: 'Plants use sunlight to produce sugars through photosynthesis.' },
  { id: 'q3', choice: 'C', explanation: 'Wind is replenished by natural atmospheric processes.' },
];

const ids = [
  'paste-form', 'source', 'exclusions', 'source-count', 'load-example', 'review', 'clear',
  'step-paste', 'step-review', 'step-answers', 'review-title', 'review-description',
  'empty-state', 'review-content', 'result-summary', 'issues', 'removed', 'removed-summary',
  'removed-list', 'question-list', 'answer', 'answer-note', 'copy', 'status',
];
const ui = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)]));
let review = null;
let answers = null;

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
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function isExample() {
  return ui.source.value.trim() === example && !ui.exclusions.value.trim();
}

function questionCard(question, answer) {
  const card = element('li', '', 'question-card');
  const heading = element('h3');
  heading.append(element('span', `${question.number}.`, 'question-number'), element('span', question.stem));
  const options = element('ul', '', 'option-list');

  for (const letter of LETTERS) {
    const option = element('li', '', 'option');
    option.dataset.letter = letter;
    option.append(element('strong', letter, 'option-label'), element('span', question.options[letter], 'option-text'));
    if (answer?.choice === letter) {
      option.classList.add('is-answer');
      option.append(element('span', 'Answer', 'option-answer'));
    }
    options.append(option);
  }

  card.append(heading, options);
  if (answer?.explanation) card.append(element('p', answer.explanation, 'explanation'));
  return card;
}

function render() {
  const step = answers ? 'answers' : review ? 'review' : 'paste';
  for (const name of ['paste', 'review', 'answers']) {
    if (name === step) ui[`step-${name}`].setAttribute('aria-current', 'step');
    else ui[`step-${name}`].removeAttribute('aria-current');
  }

  ui['source-count'].textContent = plural(ui.source.value.length.toLocaleString(), 'character');
  ui.review.disabled = !ui.source.value.trim();
  ui.clear.disabled = !ui.source.value && !ui.exclusions.value;
  ui['empty-state'].hidden = Boolean(review);
  ui['review-content'].hidden = !review;
  ui.copy.hidden = !answers;
  ui['review-title'].textContent = answers ? 'Answer key' : 'Question preview';
  ui['review-description'].textContent = answers ? 'Example answers' : 'Review your cleaned list before answering.';
  const canAnswer = review?.questions.length && !review.warnings.length && isExample();
  ui.answer.disabled = !canAnswer || Boolean(answers);
  ui.answer.lastChild.textContent = isExample() ? ' Show example answers' : ' Get answers';
  ui['answer-note'].textContent = 'Review the list to continue.';
  if (!review) return;

  if (review.warnings.length) ui['answer-note'].textContent = 'Resolve the review notes to continue.';
  else if (!isExample()) ui['answer-note'].textContent = 'Example answers are available in the sample.';
  else ui['answer-note'].textContent = answers ? 'Example answer key ready.' : 'Uses built-in example answers.';
  ui['result-summary'].textContent = plural(review.questions.length, 'question');
  ui.issues.hidden = !review.warnings.length;
  ui.issues.replaceChildren(...review.warnings.map((issue) => element('li', issue)));
  ui.removed.hidden = !review.removed.length;
  ui['removed-summary'].textContent = `${plural(review.removed.length, 'paragraph')} removed`;
  ui['removed-list'].replaceChildren(...review.removed.map((paragraph) => element('li', paragraph)));

  const byId = new Map(answers?.map((answer) => [answer.id, answer]));
  ui['question-list'].replaceChildren(...review.questions.map((question) => questionCard(question, byId.get(question.id))));
}

function invalidateReview() {
  review = null;
  answers = null;
  announce();
  render();
}

ui.source.maxLength = MAX_SOURCE_LENGTH;
ui.source.addEventListener('input', invalidateReview);
ui.exclusions.addEventListener('input', invalidateReview);

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
  review = parseQuestions(ui.source.value, ui.exclusions.value);
  answers = null;
  ui.removed.open = false;
  render();
  const message = `${plural(review.questions.length, 'question')} found. ${plural(review.removed.length, 'paragraph')} removed.`;
  announce(review.warnings.length ? `${message} Check the review notes.` : message);
});

ui.answer.addEventListener('click', () => {
  if (!review || review.warnings.length || !isExample()) return;
  answers = exampleAnswers;
  render();
  announce('Example answer key ready.');
});

ui.copy.addEventListener('click', async () => {
  const byId = new Map(answers.map((answer) => [answer.id, answer.choice]));
  const key = review.questions.map(({ id, number }) => `${number}. ${byId.get(id)}`).join('\n');
  try {
    await navigator.clipboard.writeText(key);
    announce('Answer key copied.');
  } catch {
    announce('Clipboard access is unavailable in this browser.', true);
  }
});

render();
