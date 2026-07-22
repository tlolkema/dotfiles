import { Editor, Key, matchesKey } from "@mariozechner/pi-tui";
import type { Answer, Question, QuestionnaireResult, RenderOption } from "./types.ts";

// ── State machine ────────────────────────────────────────────────────────────

export class QuestionnaireState {
  readonly questions: Question[];
  readonly isMulti: boolean;
  readonly totalTabs: number;

  currentTab = 0;
  optionIndex = 0;
  inputMode = false;
  inputQuestionId: string | null = null;

  private readonly answers = new Map<string, Answer>();
  /**
   * Per-question set of toggled option indices (0-based) for multi-select
   * questions. Only populated when `allowMultiple` is true.
   */
  private readonly toggledIndices = new Map<string, Set<number>>();

  private readonly done: (result: QuestionnaireResult) => void;
  private readonly requestRefresh: () => void;

  constructor(
    questions: Question[],
    done: (result: QuestionnaireResult) => void,
    requestRefresh: () => void,
  ) {
    this.questions = questions;
    this.isMulti = questions.length > 1;
    this.totalTabs = questions.length + 1;
    this.done = done;
    this.requestRefresh = requestRefresh;
  }

  // ── Accessors ──────────────────────────────────────────────────────────────

  currentQuestion(): Question | undefined {
    return this.questions[this.currentTab];
  }

  currentOptions(): RenderOption[] {
    const q = this.currentQuestion();
    if (!q) return [];
    const opts: RenderOption[] = [...q.options];
    if (q.allowOther) {
      opts.push({ value: "__other__", label: "Type something.", isOther: true });
    }
    return opts;
  }

  allAnswered(): boolean {
    return this.questions.every((q) => this.answers.has(q.id));
  }

  getAnswer(questionId: string): Answer | undefined {
    return this.answers.get(questionId);
  }

  /** Returns the toggled indices set for the given question id (read-only). */
  getToggledIndices(questionId: string): ReadonlySet<number> {
    return this.toggledIndices.get(questionId) ?? new Set();
  }

  // ── Mutations ──────────────────────────────────────────────────────────────

  private submit(cancelled: boolean) {
    this.done({
      questions: this.questions,
      answers: Array.from(this.answers.values()),
      cancelled,
    });
  }

  private advanceAfterAnswer() {
    if (!this.isMulti) {
      this.submit(false);
      return;
    }
    if (this.currentTab < this.questions.length - 1) {
      this.currentTab++;
    } else {
      this.currentTab = this.questions.length;
    }
    this.optionIndex = 0;
    this.requestRefresh();
  }

  private saveAnswer(
    questionId: string,
    values: string[],
    labels: string[],
    wasCustom: boolean,
    indices?: number[],
  ) {
    this.answers.set(questionId, { id: questionId, values, labels, wasCustom, indices });
  }

  private toggleOption(questionId: string, optionIndex: number) {
    if (!this.toggledIndices.has(questionId)) {
      this.toggledIndices.set(questionId, new Set());
    }
    const set = this.toggledIndices.get(questionId)!;
    if (set.has(optionIndex)) {
      set.delete(optionIndex);
    } else {
      set.add(optionIndex);
    }
    this.requestRefresh();
  }

  private commitMultiSelect(q: Question, opts: RenderOption[]) {
    const toggled = this.toggledIndices.get(q.id);
    if (!toggled || toggled.size === 0) return; // nothing selected — don't advance

    const sorted = [...toggled].sort((a, b) => a - b);
    const values = sorted.map((i) => opts[i]!.value);
    const labels = sorted.map((i) => opts[i]!.label);
    const indices = sorted.map((i) => i + 1); // 1-based
    this.saveAnswer(q.id, values, labels, false, indices);
    this.advanceAfterAnswer();
  }

  // ── Input handling ─────────────────────────────────────────────────────────

  handleEditorSubmit(value: string) {
    if (!this.inputQuestionId) return;
    const trimmed = value.trim() || "(no response)";
    this.saveAnswer(this.inputQuestionId, [trimmed], [trimmed], true);
    this.inputMode = false;
    this.inputQuestionId = null;
    this.advanceAfterAnswer();
  }

  handleInput(data: string, editor: Editor) {
    if (this.inputMode) {
      if (matchesKey(data, Key.escape)) {
        this.inputMode = false;
        this.inputQuestionId = null;
        editor.setText("");
        this.requestRefresh();
        return;
      }
      editor.handleInput(data);
      this.requestRefresh();
      return;
    }

    const q = this.currentQuestion();
    const opts = this.currentOptions();

    if (this.isMulti) {
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
        this.currentTab = (this.currentTab + 1) % this.totalTabs;
        this.optionIndex = 0;
        this.requestRefresh();
        return;
      }
      if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
        this.currentTab = (this.currentTab - 1 + this.totalTabs) % this.totalTabs;
        this.optionIndex = 0;
        this.requestRefresh();
        return;
      }
    }

    if (this.currentTab === this.questions.length) {
      if (matchesKey(data, Key.enter) && this.allAnswered()) {
        this.submit(false);
      } else if (matchesKey(data, Key.escape)) {
        this.submit(true);
      }
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.optionIndex = Math.max(0, this.optionIndex - 1);
      this.requestRefresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.optionIndex = Math.min(opts.length - 1, this.optionIndex + 1);
      this.requestRefresh();
      return;
    }

    // Space — toggle for multi-select questions
    if (data === " " && q?.allowMultiple) {
      const opt = opts[this.optionIndex];
      if (opt && !opt.isOther) {
        this.toggleOption(q.id, this.optionIndex);
        return;
      }
    }

    if (matchesKey(data, Key.enter) && q) {
      const opt = opts[this.optionIndex];

      if (q.allowMultiple) {
        // Enter confirms the whole multi-select
        this.commitMultiSelect(q, opts);
        return;
      }

      if (opt?.isOther) {
        this.inputMode = true;
        this.inputQuestionId = q.id;
        editor.setText("");
        this.requestRefresh();
        return;
      }
      if (opt) {
        this.saveAnswer(q.id, [opt.value], [opt.label], false, [this.optionIndex + 1]);
        this.advanceAfterAnswer();
      }
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.submit(true);
    }
  }
}
