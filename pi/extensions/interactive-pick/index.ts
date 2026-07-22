/**
 * Interactive Pick Extension
 *
 * Registers the `questionnaire` tool and injects a system prompt rule so the
 * agent automatically uses it whenever it needs to present multiple-choice
 * options to the user — instead of asking in plain text and waiting for a
 * typed reply like "1, A".
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Editor, Text, truncateToWidth } from "@mariozechner/pi-tui";
import { QuestionnaireParams } from "./schema.ts";
import { QuestionnaireState } from "./questionnaire-state.ts";
import { renderQuestionnaire, makeEditorTheme } from "./questionnaire-renderer.ts";
import { errorResult, formatAnswer } from "./utils.ts";
import type { Question, QuestionnaireResult } from "./types.ts";

// ── System prompt rule ───────────────────────────────────────────────────────

const SYSTEM_PROMPT_RULE = `
## User interaction rule — multiple choice selections

Whenever you need the user to choose from a set of options (e.g. selecting test cases, picking an environment, choosing a mode), you MUST use the \`questionnaire\` tool instead of listing the options in plain text and waiting for the user to type a reply.

- Use a single \`questionnaire\` call with all questions at once where possible (e.g. "which test cases?" and "which environment?" can be one call with two questions).
- Set \`allowOther: false\` unless free-text input genuinely makes sense.
- Set \`allowMultiple: true\` when the user should be able to pick more than one option (e.g. selecting multiple test cases, features, or tags).
- Do NOT print a numbered/lettered list and ask the user to reply with numbers or letters.
`.trim();

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  pi.on("before_agent_start", async (event) => {
    return {
      systemPrompt: `${event.systemPrompt}\n\n${SYSTEM_PROMPT_RULE}`,
    };
  });

  pi.registerTool({
    name: "questionnaire",
    label: "Questionnaire",
    description:
      "Ask the user one or more questions with interactive keyboard-navigable selection. " +
      "Use this whenever you need the user to pick from a set of options. " +
      "For a single question shows a simple list; for multiple questions shows a tab interface. " +
      "Set allowMultiple: true on a question to let the user toggle multiple options with Space and confirm with Enter.",
    parameters: QuestionnaireParams,

    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return errorResult("Error: UI not available (running in non-interactive mode)");
      }
      if (params.questions.length === 0) {
        return errorResult("Error: No questions provided");
      }

      const questions: Question[] = params.questions.map((q, i) => ({
        ...q,
        label: q.label || `Q${i + 1}`,
        allowOther: q.allowOther !== false,
        allowMultiple: q.allowMultiple === true,
      }));

      const result = await ctx.ui.custom<QuestionnaireResult>(
        (tui, theme, _kb, done) => {
          const editor = new Editor(tui, makeEditorTheme(theme));
          let cachedLines: string[] | undefined;

          const state = new QuestionnaireState(
            questions,
            done,
            () => {
              cachedLines = undefined;
              tui.requestRender();
            },
          );

          editor.onSubmit = (value) => {
            state.handleEditorSubmit(value);
            editor.setText("");
          };

          return {
            render(width: number): string[] {
              if (cachedLines) return cachedLines;
              cachedLines = renderQuestionnaire(state, editor, theme, width);
              return cachedLines;
            },
            invalidate() {
              cachedLines = undefined;
            },
            handleInput(data: string) {
              state.handleInput(data, editor);
            },
          };
        },
      );

      if (result.cancelled) {
        return {
          content: [{ type: "text", text: "User cancelled" }],
          details: result,
        };
      }

      const answerLines = result.answers.map((a) => {
        const qLabel = questions.find((q) => q.id === a.id)?.label ?? a.id;
        return formatAnswer(a, qLabel);
      });

      return {
        content: [{ type: "text", text: answerLines.join("\n") }],
        details: result,
      };
    },

    renderCall(args, theme) {
      const qs = (args.questions as Question[]) || [];
      const count = qs.length;
      const labels = qs.map((q) => q.label || q.id).join(", ");
      let text = theme.fg("toolTitle", theme.bold("questionnaire "));
      text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
      if (labels) text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as QuestionnaireResult | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      if (details.cancelled) {
        return new Text(theme.fg("warning", "Cancelled"), 0, 0);
      }
      const lines = details.answers.map((a) => {
        if (a.wasCustom) {
          return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}: ${theme.fg("muted", "(wrote) ")}${a.labels[0]}`;
        }
        const display = a.labels
          .map((lbl, i) => `${a.indices?.[i] ?? i + 1}. ${lbl}`)
          .join(", ");
        return `${theme.fg("success", "✓ ")}${theme.fg("accent", a.id)}: ${display}`;
      });
      return new Text(lines.join("\n"), 0, 0);
    },
  });
}
