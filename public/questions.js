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

const questionStart = /^\s*(?:(?:question|q)\s*#?\s*(\d{1,5})\s*(?:[.):\-–]\s*|\s+|$)|(\d{1,5})(?:[.):](?!\d)\s*|\s+[-–]\s*))(.*)$/i;
const optionAtStart = /^\s*(?:\(([A-D])\)|([A-D])(?:[.):]|\s+[-–]))\s*(.*)$/i;
const inlineOptions = /(^|\s)(?:\(([A-D])\)|([A-D])(?:[.):]|\s+[-–]))(?=\s|$)/gi;
const answerInstruction = /\b(?:select|choose)\s+(?:(?:the\s+)?(?:best|correct)\s+answer|all\s+that\s+apply)\s*[.!]?\s*$/i;
const portalPrompt = /^Do you understand\s*\?\s*\.$/i;
const portalFooter = /^(?:\d+(?:[.,]\d+)?\s+points?|Coursera Honor Code|Last saved on [^\n]+)[\t ]*(?:\n|$)/i;
const fenceStart = /^\s*(`{3,}|~{3,})(.*)$/;

function indentation(text) {
  return text.match(/^[\t ]*/)[0].replaceAll('\t', '    ').length;
}

function tokenize(source) {
  const rawLines = source.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const lines = [];
  let unclosedFence = false;
  let labelIndent = 0;

  for (let index = 0; index < rawLines.length; index += 1) {
    const text = rawLines[index];
    const label = text.match(questionStart) ?? text.match(optionAtStart);
    const rest = label?.[3];
    const inner = rest?.match(questionStart)?.[3];
    const fence = text.match(fenceStart) ?? rest?.match(fenceStart) ?? inner?.match(fenceStart);
    if (fence && (fence[1][0] === '~' || !fence[2].includes('`'))) {
      const [opening, marker] = fence;
      if (opening !== text) lines.push({ text: text.slice(0, -opening.length).trimEnd() });
      const closing = new RegExp(`^\\s*${marker[0]}{${marker.length},}\\s*$`);
      const block = [opening];
      while (index + 1 < rawLines.length) {
        block.push(rawLines[++index]);
        if (closing.test(block.at(-1))) break;
      }
      if (block.length === 1 || !closing.test(block.at(-1))) unclosedFence = true;
      lines.push({ text: block.join('\n'), code: true });
      continue;
    }

    const codeIndent = labelIndent + 4;
    if (!label && text.trim() && indentation(text) >= codeIndent) {
      let end = index;
      for (let next = index + 1; next < rawLines.length; next += 1) {
        const line = rawLines[next];
        if (!line.trim()) continue;
        if (indentation(line) < codeIndent) break;
        end = next;
      }
      lines.push({ text: rawLines.slice(index, end + 1).join('\n'), code: true });
      index = end;
      continue;
    }

    if (label) labelIndent = indentation(text);
    lines.push({ text });
  }
  return { lines, unclosedFence };
}

function blank(line) {
  return !line.code && !line.text.trim();
}

function paragraphs(lines) {
  const blocks = [];
  let block = [];
  for (const line of lines) {
    if (blank(line)) {
      if (block.length) blocks.push(block);
      block = [];
    } else {
      block.push(line);
    }
  }
  if (block.length) blocks.push(block);
  return blocks;
}

function contentText(lines) {
  const start = lines.findIndex((line) => !blank(line));
  if (start === -1) return '';
  const end = lines.findLastIndex((line) => !blank(line));
  return lines.slice(start, end + 1).map((line, index) => {
    let { text } = line;
    if (line.code) return text;
    if (index === 0) text = text.trimStart();
    if (start + index === end) text = text.trimEnd();
    return text;
  }).join('\n');
}

function startsWithFiller(block, pattern) {
  return !block[0].code && pattern.test(contentText(block));
}

function splitInlineOptions(lines) {
  return lines.flatMap((line) => {
    if (line.code) return [line];
    const { text } = line;
    const textWithoutCode = text.replace(/(?<!`)(`+)[^`]*\1(?!`)/g, (match) => ' '.repeat(match.length));
    const matches = [...textWithoutCode.matchAll(inlineOptions)];
    const letters = matches.map((match) => (match[2] ?? match[3]).toUpperCase()).join('');
    if (letters !== 'ABCD') return [line];

    return [
      text.slice(0, matches[0].index).trim(),
      ...matches.map((match, index) => text.slice(match.index, matches[index + 1]?.index).trim()),
    ].map((part) => ({ text: part }));
  });
}

function splitQuestions(lines) {
  const numbered = [];
  const prefix = [];
  for (const line of lines) {
    const start = !line.code && line.text.match(questionStart);
    if (start) {
      const number = start[1] ?? start[2];
      const nested = start[2] && start[3].match(questionStart);
      const stem = nested?.[1] && Number(nested[1]) === Number(number) ? nested[3] : start[3];
      const previous = numbered.at(-1);
      if (start[1] && previous?.bareNumber && Number(previous.number) === Number(number)
        && previous.lines.every(blank)) {
        previous.lines = [{ text: stem }];
        previous.bareNumber = false;
      } else {
        numbered.push({ number, lines: [{ text: stem }], bareNumber: Boolean(start[2]) && !start[3].trim() });
      }
    } else {
      (numbered.at(-1)?.lines ?? prefix).push(line);
    }
  }
  if (numbered.length) return { sections: numbered, prefix };

  // Unnumbered questions can be separated by a blank line after option D.
  const sections = [];
  let current = [];
  let lastOption;
  const expanded = splitInlineOptions(lines);
  for (let index = 0; index < expanded.length; index += 1) {
    const line = expanded[index];
    if (blank(line) && lastOption === 'D') {
      let next = index + 1;
      while (next < expanded.length && blank(expanded[next])) next += 1;
      if (expanded[next]?.code) {
        current.push(...expanded.slice(index, next));
      } else {
        sections.push(current);
        current = [];
        lastOption = undefined;
      }
      index = next - 1;
      continue;
    }
    const option = !line.code && line.text.match(optionAtStart);
    if (option) lastOption = (option[1] ?? option[2]).toUpperCase();
    current.push(line);
  }
  if (current.some((line) => !blank(line))) sections.push(current);
  const hasOption = (section) => section.some((line) => !line.code && optionAtStart.test(line.text));
  return {
    sections: sections.filter(hasOption)
      .map((section, index) => ({ number: String(index + 1), lines: section })),
    prefix: sections.filter((section) => !hasOption(section)).flat(),
  };
}

function readUnlabeledParts(lines) {
  const blocks = paragraphs(lines);
  const instructionIndex = blocks.findIndex((block) => !block.at(-1).code && answerInstruction.test(contentText(block)));
  const stemEnd = instructionIndex === -1 && blocks.length === LETTERS.length + 1 ? 0 : instructionIndex;
  if (stemEnd < 0) return null;

  const optionsStart = stemEnd + 1;
  const afterStem = blocks.slice(optionsStart);
  const footerIndex = afterStem.findIndex((block, index) => index >= LETTERS.length && startsWithFiller(block, portalFooter));
  const beforeFooter = footerIndex === -1 ? afterStem : afterStem.slice(0, footerIndex);
  const withoutPrompt = beforeFooter.filter((block) => !startsWithFiller(block, /^Do you understand\s*\?$/i));
  const chosen = (withoutPrompt.length >= LETTERS.length ? withoutPrompt : beforeFooter).slice(0, LETTERS.length);
  if (chosen.length !== LETTERS.length) return null;

  const finalChoice = splitLastChoice(chosen.at(-1));
  return {
    stem: blocks.slice(0, optionsStart).map(contentText).join('\n\n'),
    choices: [...chosen.slice(0, -1).map(contentText), contentText(finalChoice.body)],
    trailing: [...afterStem.filter((block) => !chosen.includes(block)).map(contentText), ...finalChoice.trailing],
  };
}

function splitLastChoice(lines) {
  let hasChoice = false;
  const metadata = lines.findIndex((line) => {
    if (hasChoice && !line.code && portalFooter.test(line.text.trim())) return true;
    hasChoice ||= !blank(line);
    return false;
  });
  const blocks = paragraphs(lines);
  const firstExtra = lines.some((line) => line.code) ? null : blocks[1]?.[0];
  const end = metadata !== -1 ? metadata : firstExtra ? lines.indexOf(firstExtra) : lines.length;
  return { body: lines.slice(0, end), trailing: paragraphs(lines.slice(end)).map(contentText) };
}

function readSection(section, index) {
  const parts = [[]];
  const letters = [];
  const filler = [];
  const lines = section.lines.filter((line) => {
    if (line.code || !portalPrompt.test(line.text.trim())) return true;
    filler.push(line.text.trim());
    return false;
  });
  for (const line of splitInlineOptions(lines)) {
    const option = !line.code && line.text.match(optionAtStart);
    if (option) {
      letters.push((option[1] ?? option[2]).toUpperCase());
      parts.push([{ text: option[3] }]);
    } else {
      parts.at(-1).push(line);
    }
  }

  const hasFourLabels = letters.join('') === 'ABCD';
  const lastChoice = hasFourLabels ? splitLastChoice(parts.at(-1)) : null;
  if (lastChoice) parts[parts.length - 1] = lastChoice.body;

  const [stemLines, ...choiceLines] = parts;
  const unlabeled = letters.length ? null : readUnlabeledParts(lines);
  const stem = unlabeled?.stem ?? contentText(stemLines);
  const choices = unlabeled?.choices ?? choiceLines.map(contentText);
  if (!stem || (!unlabeled && !hasFourLabels) || choices.some((choice) => !choice)) {
    return { issue: `Question ${section.number} needs question text and four options. Use A–D labels or separate the options with blank lines.` };
  }
  return {
    question: {
      id: `q${index + 1}`,
      number: section.number,
      stem,
      options: Object.fromEntries(LETTERS.map((letter, optionIndex) => [letter, choices[optionIndex]])),
    },
    trailing: [...filler, ...(unlabeled?.trailing ?? lastChoice.trailing)],
  };
}

function exclusionKey(block) {
  const text = contentText(block);
  return block.some((line) => line.code) ? text : text.replace(/\s+/g, ' ');
}

export function parseQuestions(source, exclusions = '') {
  const removed = [];
  const warnings = [];
  const questions = [];
  const result = { questions, removed, warnings };
  const { lines, unclosedFence } = tokenize(source);
  const targets = new Set(paragraphs(tokenize(exclusions).lines).map(exclusionKey));
  const matched = new Set();
  let protectedParagraphCount = 0;
  const excludedLines = new Set();
  for (const block of paragraphs(lines)) {
    const key = exclusionKey(block);
    if (!targets.has(key)) continue;
    matched.add(key);
    if (splitInlineOptions(block).some((line) => !line.code && (questionStart.test(line.text) || optionAtStart.test(line.text)))) {
      protectedParagraphCount += 1;
      continue;
    }
    removed.push(contentText(block));
    for (const line of block) excludedLines.add(line);
  }

  const { sections, prefix } = splitQuestions(lines.filter((line) => !excludedLines.has(line)));
  if (splitInlineOptions(prefix).some((line) => !line.code && optionAtStart.test(line.text))) {
    warnings.push('Some options appear before the first numbered question. Add a number to every question to include the whole list.');
  } else {
    removed.push(...paragraphs(prefix).map(contentText));
  }
  for (const [index, section] of sections.entries()) {
    const entry = readSection(section, index);
    if (entry.issue) {
      warnings.push(entry.issue);
    } else {
      questions.push(entry.question);
      removed.push(...entry.trailing);
    }
  }

  if (protectedParagraphCount) warnings.push('An excluded paragraph contains a question or option label. Narrow the exclusion to the surrounding text.');
  if (matched.size !== targets.size) warnings.push('Some excluded paragraphs could not be found. Copy each complete paragraph from the pasted text.');
  if (unclosedFence) warnings.push('A code block is missing its closing fence. Close it before reviewing the questions again.');
  if (!sections.length) warnings.push('No questions found. Use A, B, C, and D labels for each set of options.');
  if (sections.length > MAX_QUESTIONS) warnings.push(`Review at most ${MAX_QUESTIONS} questions at a time.`);
  return result;
}
