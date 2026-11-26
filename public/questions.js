export const LETTERS = Object.freeze(['A', 'B', 'C', 'D']);
export const MAX_QUESTIONS = 50;
export const MAX_SOURCE_LENGTH = 60_000;

export function distinguishingPrefixEnd(answer, alternatives) {
  const words = [...answer.matchAll(/\S+/gu)];
  let sharedWords = 0;

  for (const alternative of alternatives) {
    const otherWords = alternative.match(/\S+/gu) ?? [];
    let common = 0;
    while (common < words.length && words[common][0] === otherWords[common]) common += 1;
    sharedWords = Math.max(sharedWords, common);
  }

  const lastWord = words[Math.min(sharedWords, words.length - 1)];
  return lastWord ? lastWord.index + lastWord[0].length : 0;
}

const questionStart = /^\s*(?:(?:question|q)\s*#?\s*(\d{1,5})\s*(?:[.):\-–]\s*|\s+|$)|(\d{1,5})(?:[.):]\s*|\s+[-–]\s*))(.*)$/i;
const optionAtStart = /^\s*(?:\(([A-D])\)|([A-D])(?:[.):]|\s+[-–]))\s*(.*)$/i;
const inlineOptions = /(^|\s)(?:\(([A-D])\)|([A-D])(?:[.):]|\s+[-–]))(?=\s|$)/gi;

function splitInlineOptions(lines) {
  return lines.flatMap((line) => {
    const matches = [...line.matchAll(inlineOptions)];
    const letters = matches.map((match) => (match[2] ?? match[3]).toUpperCase()).join('');
    if (letters !== 'ABCD') return [line];

    return [
      line.slice(0, matches[0].index).trim(),
      ...matches.map((match, index) => line.slice(match.index, matches[index + 1]?.index).trim()),
    ];
  });
}

function splitQuestions(lines) {
  const numbered = [];
  const prefix = [];
  for (const line of lines) {
    const start = line.match(questionStart);
    if (start) {
      numbered.push({ number: start[1] ?? start[2], lines: [start[3]] });
    } else {
      (numbered.at(-1)?.lines ?? prefix).push(line);
    }
  }
  if (numbered.length) return { sections: numbered, prefix };

  // Unnumbered questions can be separated by a blank line after option D.
  const sections = [];
  let current = [];
  let lastOption;
  for (const line of splitInlineOptions(lines)) {
    if (!line.trim() && lastOption === 'D') {
      sections.push(current);
      current = [];
      lastOption = undefined;
      continue;
    }
    const option = line.match(optionAtStart);
    if (option) lastOption = (option[1] ?? option[2]).toUpperCase();
    current.push(line);
  }
  if (current.some((line) => line.trim())) sections.push(current);
  return {
    sections: sections.filter((section) => section.some((line) => optionAtStart.test(line)))
      .map((section, index) => ({ number: String(index + 1), lines: section })),
    prefix: sections.filter((section) => !section.some((line) => optionAtStart.test(line))).flat(),
  };
}

function readSection(section, index) {
  const parts = [[]];
  const letters = [];
  for (const line of splitInlineOptions(section.lines)) {
    const option = line.match(optionAtStart);
    if (option) {
      letters.push((option[1] ?? option[2]).toUpperCase());
      parts.push([option[3]]);
    } else {
      parts.at(-1).push(line);
    }
  }

  const trailing = [];
  const finalPart = parts.at(-1);
  if (letters.join('') === 'ABCD') {
    while (finalPart.at(-1) !== undefined && !finalPart.at(-1).trim()) finalPart.pop();
    const separator = finalPart.findIndex((line, lineIndex) => lineIndex > 0 && !line.trim()
      && finalPart.slice(0, lineIndex).some((part) => part.trim()));
    if (separator !== -1) trailing.push(...finalPart.splice(separator));
  }

  const [stem, ...choices] = parts.map((part) => part.join('\n').trim());
  if (!stem || letters.join('') !== 'ABCD' || choices.some((choice) => !choice)) {
    return { issue: `Question ${section.number} needs question text and four options labeled A through D.` };
  }
  return {
    question: {
      id: `q${index + 1}`,
      number: section.number,
      stem,
      options: Object.fromEntries(LETTERS.map((letter, optionIndex) => [letter, choices[optionIndex]])),
    },
    trailing,
  };
}

function paragraphs(text) {
  return text.split(/\n[\t ]*\n+/).map((part) => part.trim()).filter(Boolean);
}

export function parseQuestions(source, exclusions = '') {
  const removed = [];
  const warnings = [];
  const questions = [];
  const result = { questions, removed, warnings };
  const normalized = source.replace(/\r\n?/g, '\n');
  const targets = new Set(paragraphs(exclusions.replace(/\r\n?/g, '\n')));
  const matched = new Set();
  let protectedParagraphCount = 0;
  const cleaned = normalized.split(/(\n[\t ]*\n+)/).map((part, index) => {
    if (index % 2 || !targets.has(part.trim())) return part;
    matched.add(part.trim());
    if (splitInlineOptions(part.split('\n')).some((line) => questionStart.test(line) || optionAtStart.test(line))) {
      protectedParagraphCount += 1;
      return part;
    }
    removed.push(part.trim());
    return '';
  }).join('');

  const { sections, prefix } = splitQuestions(cleaned.split('\n'));
  if (splitInlineOptions(prefix).some((line) => optionAtStart.test(line))) {
    warnings.push('Some options appear before the first numbered question. Add a number to every question to include the whole list.');
  } else {
    removed.push(...paragraphs(prefix.join('\n')));
  }
  for (const [index, section] of sections.entries()) {
    const entry = readSection(section, index);
    if (entry.issue) {
      warnings.push(entry.issue);
    } else {
      questions.push(entry.question);
      removed.push(...paragraphs(entry.trailing.join('\n')));
    }
  }

  if (protectedParagraphCount) warnings.push('An excluded paragraph contains a question or option label. Narrow the exclusion to the surrounding text.');
  if (matched.size !== targets.size) warnings.push('Some excluded paragraphs could not be found. Copy each paragraph exactly as pasted.');
  if (!sections.length) warnings.push('No questions found. Use A, B, C, and D labels for each set of options.');
  if (sections.length > MAX_QUESTIONS) warnings.push(`Review at most ${MAX_QUESTIONS} questions at a time.`);
  return result;
}
