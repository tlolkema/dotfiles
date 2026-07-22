import { Type } from "@sinclair/typebox";

// ── Schema ───────────────────────────────────────────────────────────────────

export const QuestionOptionSchema = Type.Object({
  value: Type.String({ description: "The value returned when selected" }),
  label: Type.String({ description: "Display label for the option" }),
  description: Type.Optional(
    Type.String({ description: "Optional description shown below label" }),
  ),
});

export const QuestionSchema = Type.Object({
  id: Type.String({ description: "Unique identifier for this question" }),
  label: Type.Optional(
    Type.String({
      description:
        "Short label for the tab bar, e.g. 'Test cases', 'Environment' (defaults to Q1, Q2, …)",
    }),
  ),
  prompt: Type.String({ description: "The full question text to display" }),
  options: Type.Array(QuestionOptionSchema, {
    description: "Available options to choose from",
  }),
  allowOther: Type.Optional(
    Type.Boolean({
      description: "Allow the user to type a custom answer (default: true)",
    }),
  ),
  allowMultiple: Type.Optional(
    Type.Boolean({
      description:
        "Allow the user to select multiple options with Space, confirmed with Enter (default: false)",
    }),
  ),
});

export const QuestionnaireParams = Type.Object({
  questions: Type.Array(QuestionSchema, {
    description: "One or more questions to ask the user",
  }),
});
