/**
 * Graceful unsupported-browser screen. When capability detection says the
 * browser cannot run WebGL2, the app mounts this instead of leaving a black
 * canvas. The view-model (`supportScreenContent`) is pure and unit-tested; the
 * DOM mount is a thin, accessible projection of it.
 */

import type { SupportAssessment } from "../engine/capabilities";

export interface SupportScreenContent {
  title: string;
  summary: string;
  /** The capability(ies) that are missing, e.g. `["WebGL2"]`. */
  reasons: string[];
  /** Concrete, ordered remediation steps. */
  steps: string[];
}

export interface SupportScreen {
  readonly element: HTMLElement;
  dispose(): void;
}

const DEFAULT_STEPS = [
  "Update to the latest version of Chrome, Edge, Firefox, or Safari 16 or newer.",
  "Enable hardware acceleration / WebGL in your browser settings, then reload.",
  "On a virtual machine or remote desktop, enable GPU passthrough or switch to a machine with a supported GPU.",
  "Try a different browser or device — Apex Rally requires a WebGL2-capable GPU.",
];

/** Deterministic content for the fallback screen (no user input is interpolated). */
export function supportScreenContent(assessment: SupportAssessment): SupportScreenContent {
  const reasons = assessment.missing.length > 0 ? [...assessment.missing] : ["WebGL2"];
  return {
    title: "Apex Rally can't run in this browser",
    summary: assessment.reason,
    reasons,
    steps: [...DEFAULT_STEPS],
  };
}

/**
 * Mount the fallback into `host`, replacing any previous content. Carries
 * `role="alert"` (assertive announcement) and `data-support="unsupported"` plus
 * `data-missing` for tooling and the Playwright smoke.
 */
export function mountSupportScreen(
  host: HTMLElement,
  assessment: SupportAssessment,
  doc: Document = document,
): SupportScreen {
  const content = supportScreenContent(assessment);

  const root = doc.createElement("div");
  root.className = "support-screen";
  root.setAttribute("role", "alert");
  root.setAttribute("data-support", assessment.level);
  root.setAttribute("data-missing", content.reasons.join(","));

  const title = doc.createElement("h1");
  title.className = "support-screen__title";
  title.textContent = content.title;
  root.appendChild(title);

  const summary = doc.createElement("p");
  summary.className = "support-screen__summary";
  summary.textContent = content.summary;
  root.appendChild(summary);

  const reasonLabel = doc.createElement("p");
  reasonLabel.className = "support-screen__label";
  reasonLabel.textContent = "Missing requirement";
  root.appendChild(reasonLabel);

  const reasonList = doc.createElement("ul");
  reasonList.className = "support-screen__reasons";
  for (const reason of content.reasons) {
    const item = doc.createElement("li");
    item.textContent = reason;
    reasonList.appendChild(item);
  }
  root.appendChild(reasonList);

  const stepsLabel = doc.createElement("p");
  stepsLabel.className = "support-screen__label";
  stepsLabel.textContent = "What you can do";
  root.appendChild(stepsLabel);

  const steps = doc.createElement("ol");
  steps.className = "support-screen__steps";
  for (const step of content.steps) {
    const item = doc.createElement("li");
    item.textContent = step;
    steps.appendChild(item);
  }
  root.appendChild(steps);

  host.replaceChildren(root);

  return {
    element: root,
    dispose() {
      if (root.parentNode === host) host.replaceChildren();
    },
  };
}
