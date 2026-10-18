import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const RELATIVE_SPECIFIER = /^\.\.?\//;
const EXPLICIT_EXTENSION = /\.(?:[cm]?[jt]sx?|json)$/;
const TYPESCRIPT_SUFFIXES = [".ts", ".tsx", "/index.ts"];

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (context.parentURL === undefined || !RELATIVE_SPECIFIER.test(specifier) || EXPLICIT_EXTENSION.test(specifier)) {
      return nextResolve(specifier, context);
    }
    for (const suffix of TYPESCRIPT_SUFFIXES) {
      const candidate = new URL(specifier + suffix, context.parentURL);
      if (existsSync(fileURLToPath(candidate))) {
        return nextResolve(candidate.href, context);
      }
    }
    return nextResolve(specifier, context);
  },
});
