// ── Types ────────────────────────────────────────────────────────────────────

export interface QuestionOption {
  value: string;
  label: string;
  description?: string;
}

export type RenderOption = QuestionOption & { isOther?: boolean };

export interface Question {
  id: string;
  label: string;
  prompt: string;
  options: QuestionOption[];
  allowOther: boolean;
  allowMultiple: boolean;
}

export interface Answer {
  id: string;
  /** Selected values (single-select: length 1, multi-select: 1+) */
  values: string[];
  /** Display labels matching each value */
  labels: string[];
  wasCustom: boolean;
  /** 1-based indices of selected options (undefined for custom answers) */
  indices?: number[];
}

export interface QuestionnaireResult {
  questions: Question[];
  answers: Answer[];
  cancelled: boolean;
}
