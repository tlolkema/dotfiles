import { type EditorTheme, Editor, truncateToWidth } from "@mariozechner/pi-tui";
import type { QuestionnaireState } from "./questionnaire-state.ts";

// ── Renderer ─────────────────────────────────────────────────────────────────

/** Pure render function — reads state, returns lines. No side effects. */
export function renderQuestionnaire(
  state: QuestionnaireState,
  editor: Editor,
  theme: any,
  width: number,
): string[] {
  const lines: string[] = [];
  const q = state.currentQuestion();
  const opts = state.currentOptions();
  const add = (s: string) => lines.push(truncateToWidth(s, width));

  add(theme.fg("accent", "─".repeat(width)));

  if (state.isMulti) {
    const tabs: string[] = ["← "];
    for (let i = 0; i < state.questions.length; i++) {
      const isActive = i === state.currentTab;
      const isAnswered = state.getAnswer(state.questions[i]!.id) !== undefined;
      const lbl = state.questions[i]!.label;
      const box = isAnswered ? "■" : "□";
      const color = isAnswered ? "success" : "muted";
      const text = ` ${box} ${lbl} `;
      const styled = isActive
        ? theme.bg("selectedBg", theme.fg("text", text))
        : theme.fg(color, text);
      tabs.push(`${styled} `);
    }
    const canSubmit = state.allAnswered();
    const isSubmitTab = state.currentTab === state.questions.length;
    const submitText = " ✓ Submit ";
    const submitStyled = isSubmitTab
      ? theme.bg("selectedBg", theme.fg("text", submitText))
      : theme.fg(canSubmit ? "success" : "dim", submitText);
    tabs.push(`${submitStyled} →`);
    add(` ${tabs.join("")}`);
    lines.push("");
  }

  function renderOptions() {
    const toggled = q ? state.getToggledIndices(q.id) : new Set<number>();

    for (let i = 0; i < opts.length; i++) {
      const opt = opts[i]!;
      const focused = i === state.optionIndex;
      const isOther = opt.isOther === true;
      const prefix = focused ? theme.fg("accent", "> ") : "  ";
      const color = focused ? "accent" : "text";

      const rawLabel = opt.label.replace(/^\d+\.\s+/, "");
      if (q?.allowMultiple && !isOther) {
        const checked = toggled.has(i);
        const checkbox = checked ? theme.fg("success", "[✓]") : theme.fg("muted", "[ ]");
        const label = theme.fg(color, ` ${i + 1}. ${rawLabel}`);
        add(`${prefix}${checkbox}${label}`);
      } else if (isOther && state.inputMode) {
        add(prefix + theme.fg("accent", `${i + 1}. ${rawLabel} ✎`));
      } else {
        add(prefix + theme.fg(color, `${i + 1}. ${rawLabel}`));
      }

      if (opt.description) {
        add(`       ${theme.fg("muted", opt.description)}`);
      }
    }
  }

  if (state.inputMode && q) {
    add(theme.fg("text", ` ${q.prompt}`));
    lines.push("");
    renderOptions();
    lines.push("");
    add(theme.fg("muted", " Your answer:"));
    for (const line of editor.render(width - 2)) {
      add(` ${line}`);
    }
    lines.push("");
    add(theme.fg("dim", " Enter to submit • Esc to cancel"));
  } else if (state.currentTab === state.questions.length) {
    add(theme.fg("accent", theme.bold(" Ready to submit")));
    lines.push("");
    for (const question of state.questions) {
      const answer = state.getAnswer(question.id);
      if (answer) {
        const prefix = answer.wasCustom ? "(wrote) " : "";
        const display = answer.wasCustom
          ? answer.labels[0]!
          : answer.labels
              .map((lbl, i) => `${answer.indices?.[i] ?? i + 1}. ${lbl.replace(/^\d+\.\s+/, "")}`)
              .join(", ");
        add(
          `${theme.fg("muted", ` ${question.label}: `)}${theme.fg("text", prefix + display)}`,
        );
      }
    }
    lines.push("");
    if (state.allAnswered()) {
      add(theme.fg("success", " Press Enter to submit"));
    } else {
      const missing = state.questions
        .filter((q) => !state.getAnswer(q.id))
        .map((q) => q.label)
        .join(", ");
      add(theme.fg("warning", ` Unanswered: ${missing}`));
    }
  } else if (q) {
    add(theme.fg("text", ` ${q.prompt}`));
    lines.push("");
    renderOptions();
  }

  lines.push("");
  if (!state.inputMode) {
    let help: string;
    if (q?.allowMultiple) {
      help = state.isMulti
        ? " Tab/←→ navigate tabs • ↑↓ navigate • Space toggle • Enter confirm • Esc cancel"
        : " ↑↓ navigate • Space toggle • Enter confirm • Esc cancel";
    } else {
      help = state.isMulti
        ? " Tab/←→ navigate tabs • ↑↓ select • Enter confirm • Esc cancel"
        : " ↑↓ navigate • Enter select • Esc cancel";
    }
    add(theme.fg("dim", help));
  }
  add(theme.fg("accent", "─".repeat(width)));

  return lines;
}

export function makeEditorTheme(theme: any): EditorTheme {
  return {
    borderColor: (s) => theme.fg("accent", s),
    selectList: {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    },
  };
}
