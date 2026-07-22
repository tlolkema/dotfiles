import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { execSync } from "node:child_process";

// Plays a system sound using macOS afplay
function playSound(file: string) {
  try {
    execSync(`afplay "${file}"`, { stdio: "ignore" });
  } catch {
    // Silently ignore if sound can't be played
  }
}

export default function (pi: ExtensionAPI) {
  // Play a sound when the agent finishes and is waiting for user input
  pi.on("agent_end", async (_event, _ctx) => {
    // Glass sound = agent is done / needs your attention
    playSound("/System/Library/Sounds/Glass.aiff");
  });
}
