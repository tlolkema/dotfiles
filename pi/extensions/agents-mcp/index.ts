import { getAgentDir, ProjectTrustStore, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import agentsMcp from "./bridge.ts";

export default function (pi: ExtensionAPI) {
	agentsMcp(pi, new ProjectTrustStore(getAgentDir()));
}
