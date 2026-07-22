import type { Answer, Question, QuestionnaireResult } from "./types.ts";

// ── Helpers ──────────────────────────────────────────────────────────────────

export function errorResult(
  message: string,
  questions: Question[] = [],
): { content: { type: "text"; text: string }[]; details: QuestionnaireResult } {
  return {
    content: [{ type: "text", text: message }],
    details: { questions, answers: [], cancelled: true },
  };
}

/** Format an Answer for the LLM result text. */
export function formatAnswer(answer: Answer, questionLabel: string): string {
  if (answer.wasCustom) {
    return `${questionLabel}: user wrote: ${answer.labels[0]}`;
  }
  const selections = answer.labels
    .map((label, i) => `${answer.indices?.[i] ?? i + 1}. ${label}`)
    .join(", ");
  return `${questionLabel}: user selected: ${selections}`;
}
