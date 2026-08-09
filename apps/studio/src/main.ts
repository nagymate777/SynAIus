import { mountWorkspaceApplication } from "@synaius/workspace-ui";
import { studioApplication } from "./application";

const root = document.getElementById("root");
if (!root) throw new Error("root.missing");
mountWorkspaceApplication(root, studioApplication);
