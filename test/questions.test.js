import assert from 'node:assert/strict';
import test from 'node:test';
import { distinguishingPrefixEnd, majorityLabel, parseQuestions } from '../public/questions.js';

test('shows a majority label only for decisions with conflicting model responses', () => {
  assert.equal(majorityLabel([['B'], ['A'], ['B']]), 'Majority B');
  assert.equal(majorityLabel([['A'], ['A'], ['A']]), '');
  assert.equal(majorityLabel([['A'], ['B'], ['C']]), 'No majority');
  assert.equal(majorityLabel([['A'], ['B']]), 'No majority');
  assert.equal(majorityLabel([['B'], ['B'], []]), 'Majority B');
  assert.equal(majorityLabel([['B'], [], []]), 'No majority');
});

test('requires the same complete selection for a select-all majority', () => {
  assert.equal(majorityLabel([['D', 'B'], ['B', 'D'], ['B']]), 'Majority B, D');
  assert.equal(majorityLabel([['A', 'B'], ['A', 'C'], ['B', 'C']]), 'No majority');
});

test('highlights through the first word that distinguishes the answer from every option', () => {
  const answer = 'The apples are red and fruity but rotten.';
  const end = distinguishingPrefixEnd(answer, [
    'The apples are red and tasty but rotten.',
    'The apples are green and bitter.',
    'The apples are yellow and sweet.',
  ]);
  assert.equal(answer.slice(0, end), 'The apples are red and fruity');
  assert.equal(answer.slice(end), ' but rotten.');
});

test('keeps the answer’s original spacing and handles identical options', () => {
  const answer = 'The apples\nare  fruity but rotten.';
  const end = distinguishingPrefixEnd(answer, ['The apples are tasty but rotten.']);
  assert.equal(answer.slice(0, end), 'The apples\nare  fruity');
  assert.equal(distinguishingPrefixEnd(answer, ['The apples are fruity but rotten.']), answer.length);
  assert.equal(distinguishingPrefixEnd('Mars', ['Venus', 'Earth', 'Saturn']), 4);
});

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

test('accepts dash labels without losing the question number or options', () => {
  const result = parseQuestions('21 - First? A - One B - Two C - Three D - Four');
  assert.deepEqual(result.warnings, []);
  assert.equal(result.questions[0].number, '21');
  assert.equal(result.questions[0].options.D, 'Four');
});

test('reports a set of options before the first numbered question', () => {
  const result = parseQuestions('First? A. One B. Two C. Three D. Four\n\n9. Second? A. One B. Two C. Three D. Four');
  assert.match(result.warnings[0], /before the first numbered question/);
  assert.deepEqual(result.removed, []);
});

test('keeps a question when an exclusion contains its labels', () => {
  const source = '4. Which?\nA. One\nB. Two\nC. Three\nD. Four';
  const result = parseQuestions(source, source);
  assert.equal(result.questions.length, 1);
  assert.match(result.warnings[0], /contains a question or option label/);
  assert.deepEqual(result.removed, []);
});

test('reads copied quiz headings once and labels options separated by blank paragraphs', () => {
  const source = [
    '1.', '  ', 'Question 1', 'Which tool works? Select the best answer.', '\u00a0',
    'First', '', 'Second with', 'a wrapped line', '', 'Third', '', 'Fourth', '',
    '2. Question 2 Which tools work? Select all that apply.', '',
    'Alpha', '', 'Beta', '', 'Gamma', '', 'Delta',
  ].join('\r\n');
  const result = parseQuestions(source);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.questions.map(({ id, number, stem }) => [id, number, stem]), [
    ['q1', '1', 'Which tool works? Select the best answer.'],
    ['q2', '2', 'Which tools work? Select all that apply.'],
  ]);
  assert.deepEqual(result.questions[0].options, { A: 'First', B: 'Second with\na wrapped line', C: 'Third', D: 'Fourth' });
  assert.deepEqual(result.questions[1].options, { A: 'Alpha', B: 'Beta', C: 'Gamma', D: 'Delta' });
});

test('reads copied answer keys with bare option letters, code, and review metadata', () => {
  const code = ['~~~text', 'Question 42', 'A', 'Answer', '~~~'].join('\n');
  const optionCode = ['```python', 'print("Answer")', '```'].join('\n');
  const source = [
    '17.', 'Which phrase appears in the block?', '', code, '',
    'A', 'Question 42', 'B', '1 point', 'C', 'A. This is data', 'D', 'Do you understand?.',
    'Answer', 'This was the previous explanation.', '',
    '18.', 'Which snippet prints a value?', 'A', 'One', 'Answer', 'B', 'Two', 'C', 'Three',
    'D', optionCode, 'This was another previous explanation.',
  ].join('\n');
  const result = parseQuestions(source);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.questions.map(({ number, stem, options }) => ({ number, stem, options })), [
    { number: '17', stem: `Which phrase appears in the block?\n\n${code}`,
      options: { A: 'Question 42', B: '1 point', C: 'A. This is data', D: 'Do you understand?.' } },
    { number: '18', stem: 'Which snippet prints a value?', options: { A: 'One', B: 'Two', C: 'Three', D: optionCode } },
  ]);
  assert.deepEqual(result.removed, ['Answer\nThis was the previous explanation.', 'Answer', 'This was another previous explanation.']);
});

test('keeps multiline options when repasting a preview with bare option letters', () => {
  const source = '1.\nWhich wording matches?\nA\nAnswer\nB\nTwo\nC\nThree\nD\nFirst line\nSecond line\n\n2. Next?\nA. One\nB. Two\nC. Three\nD. Four';
  const result = parseQuestions(source);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.questions.length, 2);
  assert.deepEqual(result.questions[0].options, { A: 'Answer', B: 'Two', C: 'Three', D: 'First line\nSecond line' });
  assert.deepEqual(result.removed, []);
});

test('removes copied model comparisons without trimming multiline option text', () => {
  const source = '1.\nWhich wording matches?\nA\nOne\nAnswer\nB\nTwo\nC\nThree\nD\nFirst line\nSecond line';
  for (const comparison of ['Claude B · GPT A, C', 'Claude A, C · GPT A, C · Majority A, C', 'Claude B · GPT C · No majority']) {
    const result = parseQuestions(`${source}\n${comparison}`);
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.questions[0].options, { A: 'One', B: 'Two', C: 'Three', D: 'First line\nSecond line' });
    assert.deepEqual(result.removed, ['Answer', comparison]);
  }
});

test('preserves context through the answer instruction and removes text after the four options', () => {
  const source = '4. Read this scenario.\n\nWhich response works? Select the best answer.\n\nOne\n\nTwo\n\nThree\n\nFour\n\nEnd of preview';
  const result = parseQuestions(source);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.questions[0].stem, 'Read this scenario.\n\nWhich response works? Select the best answer.');
  assert.deepEqual(result.removed, ['End of preview']);
  assert.match(parseQuestions(source.split('\n\nFour')[0]).warnings[0], /Question 4 needs/);
});

test('removes course page text, quiz prompts, and score metadata before assigning choices', () => {
  const result = parseQuestions([
    'Course overview\nComplete two items today.',
    'Assignment details\nDue next week',
    '1.\nQuestion 1\nWhich colour works? Select the best answer.',
    'Do you understand?.', 'Red', 'Green', 'Blue', 'Gold',
    '0.5 points\nCoursera Honor Code\nSubmission notice',
  ].join('\n\n'));
  assert.deepEqual(result.warnings, []);
  assert.equal(result.questions.length, 1);
  assert.deepEqual(result.questions[0].options, { A: 'Red', B: 'Green', C: 'Blue', D: 'Gold' });
  assert.deepEqual(result.removed, [
    'Course overview\nComplete two items today.', 'Assignment details\nDue next week',
    'Do you understand?.', '0.5 points\nCoursera Honor Code\nSubmission notice',
  ]);
});

test('preserves point values and exact phrases when they are part of the four choices', () => {
  const source = '1. Which phrase or value was given? Select the best answer.\n\nDo you understand?\n\nGo now\n\n2 points\n\n4 points\n\n1 point';
  const result = parseQuestions(source);
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.questions[0].options, { A: 'Do you understand?', B: 'Go now', C: '2 points', D: '4 points' });
  assert.deepEqual(result.removed, ['1 point']);
});

test('preserves fenced code in the stem and multiple choices, including marker-shaped code lines', () => {
  const stemCode = ['```text', 'Question 2', 'A. Example', '', 'Do you understand?.', '```'].join('\n');
  const choiceB = ['```js', 'const answer = 2;', '', 'console.log(answer);', '```'].join('\n');
  const choiceD = ['~~~python', 'def answer():', '', '    return 2', '~~~'].join('\n');
  const source = [
    '1. Which option describes this example?', '', stemCode, '',
    'A. An inline example: `A. One B. Two C. Three D. Four`',
    `B. ${choiceB}`, 'C. Example three', 'D. This function returns a value:', '', choiceD, '',
    'It returns the integer 2.', '1 point', 'Coursera Honor Code', 'Submit when ready',
  ].join('\n');
  const result = parseQuestions(source);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].stem, `Which option describes this example?\n\n${stemCode}`);
  assert.deepEqual(result.questions[0].options, {
    A: 'An inline example: `A. One B. Two C. Three D. Four`',
    B: choiceB,
    C: 'Example three',
    D: `This function returns a value:\n\n${choiceD}\n\nIt returns the integer 2.`,
  });
  assert.deepEqual(result.removed, ['1 point\nCoursera Honor Code\nSubmit when ready']);
});

test('keeps unlabeled code options as single choices after removing filler and excluded text', () => {
  const fenced = ['````text', 'Optional passage to remove.', '', '```', 'A. Example', '````'].join('\n');
  const indented = ['    def answer():', '', '        return 3'].join('\n');
  const tabbed = ['\tconst value = 4;', '', '\tconsole.log(value);'].join('\n');
  const source = [
    'Page title', '1.\nQuestion 1\nReview the code sample.', fenced, 'Optional passage\n  to remove.',
    'Which options are snippets? Select all that apply.\nDo you understand?.',
    indented, 'Plain text', 'Another choice', `${tabbed}\n1 point`,
  ].join('\n\n');
  const result = parseQuestions(source, 'Optional passage to remove.');
  assert.deepEqual(result.warnings, []);
  assert.equal(result.questions[0].stem, `Review the code sample.\n\n${fenced}\n\nWhich options are snippets? Select all that apply.`);
  assert.deepEqual(result.questions[0].options, { A: indented, B: 'Plain text', C: 'Another choice', D: tabbed });
  assert.deepEqual(result.removed, ['Optional passage\n  to remove.', 'Page title', 'Do you understand?.', '1 point']);
});

test('keeps code attached to option D in unnumbered questions', () => {
  const source = 'Which answer includes code?\nA. One\nB. Two\nC. Three\nD. Code:\n\n```text\nA. inside code\n```\n\nNext question?\nA. One\nB. Two\nC. Three\nD. Four';
  const result = parseQuestions(source);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].options.D, 'Code:\n\n```text\nA. inside code\n```');
});

test('keeps the prose after a fenced final option before the next question', () => {
  const source = '1. Which statement is true?\nA. One\nB. Two\nC. Three\nD. Code:\n\n```text\nA. inside code\n```\n\nThis is the expected output.\n\n2. Next question?\nA. One\nB. Two\nC. Three\nD. Four';
  const result = parseQuestions(source);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.questions[0].options.D, 'Code:\n\n```text\nA. inside code\n```\n\nThis is the expected output.');
});

test('warns when a missing code fence would hide later questions', () => {
  const result = parseQuestions('1. What happens?\n```js\nconst value = 1;\n\nA. One\nB. Two\nC. Three\nD. Four');
  assert.match(result.warnings.join(' '), /missing its closing fence/);
  assert.deepEqual(result.questions, []);
});
