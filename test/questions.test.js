import assert from 'node:assert/strict';
import test from 'node:test';
import { parseQuestions } from '../public/questions.js';

test('keeps original question numbering, option order, and wrapped text', () => {
  const result = parseQuestions(`Course portal notice\r\n\r\n7. A question with a wrapped\r\nstem?\r\nA. First\r\nB. Second\r\nsecond line\r\nC. Third\r\nD. Fourth\r\n\r\nA page-break notice\r\n\r\nQuestion 12: One-line question? A) Red B) Green C) Blue D) Yellow`);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.removed, ['Course portal notice', 'A page-break notice']);
  assert.deepEqual(result.questions.map((question) => question.number), ['7', '12']);
  assert.equal(result.questions[0].stem, 'A question with a wrapped\nstem?');
  assert.deepEqual(result.questions[0].options, { A: 'First', B: 'Second\nsecond line', C: 'Third', D: 'Fourth' });
  assert.equal(result.questions[1].options.D, 'Yellow');
});

test('removes exact paragraphs between the stem and options without removing context', () => {
  const source = '2. Read this information.\n\nKeep this context.\n\nSkip this notice.\n\nA. One\nB. Two\nC. Three\nD. Four';
  const result = parseQuestions(source, 'Skip this notice.');
  assert.deepEqual(result.removed, ['Skip this notice.']);
  assert.match(result.questions[0].stem, /Keep this context\./);
  assert.doesNotMatch(result.questions[0].stem, /Skip/);
  assert.match(parseQuestions(source, 'Skip this').warnings[0], /could not be found/);
});

test('reports incomplete questions and keeps distinct IDs for repeated numbers', () => {
  const result = parseQuestions('1. First?\nA. One\nB. Two\nC. Three\nD. Four\n1. Second?\nA. One\nB. Two\nC. Three\nD. Four\n2. Incomplete?\nA. One');
  assert.deepEqual(result.questions.map(({ id, number }) => [id, number]), [['q1', '1'], ['q2', '1']]);
  assert.match(result.warnings[0], /Question 2/);
});

test('assigns numbers to unnumbered sets separated by a blank line', () => {
  const result = parseQuestions('First?\n(A) A\n(B) B\n(C) C\n(D) D\n\nSecond? A. 1 B. 2 C. 3 D. 4');
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.questions.map(({ number, stem }) => [number, stem]), [['1', 'First?'], ['2', 'Second?']]);
});
