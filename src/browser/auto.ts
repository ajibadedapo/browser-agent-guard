import { createGuard, type Guard, type GuardOptions } from "./guard";

declare global {
  interface Window {
    browserAgentGuard?: Guard;
  }
}

export function optionsFromScript(script: HTMLOrSVGScriptElement | null): GuardOptions {
  const data = script instanceof HTMLElement ? script.dataset : {};
  const options: GuardOptions = { mode: data.mode === "block" ? "block" : "detect" };
  if (data.action === "disable" || data.action === "message") {
    options.action = data.action;
  }
  if (data.message) {
    options.message = data.message;
  }
  if (data.tokenEndpoint) {
    options.tokenEndpoint = data.tokenEndpoint;
  }
  if (data.forms) {
    options.forms = data.forms;
  }
  return options;
}

export function installFromScript(script: HTMLOrSVGScriptElement | null): Guard {
  window.browserAgentGuard ??= createGuard(optionsFromScript(script));
  return window.browserAgentGuard;
}

installFromScript(document.currentScript);
