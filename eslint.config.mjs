import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import * as espree from "espree";
import tseslint from "typescript-eslint";

const eslintConfig = [
  // eslint-config-next 16.2.x bundles plugins (eslint-plugin-react,
  // eslint-plugin-jsx-a11y, eslint-plugin-import) that still call context
  // APIs removed in ESLint 10; fixupConfigRules restores them at runtime.
  // Drop the fixup once eslint-config-next ships ESLint 10-ready plugins.
  ...fixupConfigRules(nextVitals),
  {
    // eslint-config-next applies Next's bundled babel eslint-parser to every
    // file, but its compiled scope manager predates the ESLint 10 ScopeManager
    // contract (addGlobals) and crashes. TypeScript files are already
    // re-parsed by typescript-eslint (ESLint 10-ready); the remaining lint
    // targets are plain Node .mjs/.js scripts with no babel-only syntax, so
    // parse them with ESLint's default espree parser instead. Drop this once
    // eslint-config-next ships an ESLint 10-compatible parser.
    files: ["**/*.{js,mjs,cjs,jsx}"],
    languageOptions: {
      parser: espree
    }
  },
  {
    // Same ESLint 10 parser problem for .mts/.cts: eslint-config-next only
    // routes .ts/.tsx to typescript-eslint, leaving .d.mts declarations on
    // the crashing babel parser. Route them to typescript-eslint as well.
    files: ["**/*.{mts,cts}"],
    languageOptions: {
      parser: tseslint.parser
    }
  },
  {
    // .claude holds local git worktrees whose build artifacts must not be linted.
    ignores: [".next/**", "coverage/**", "node_modules/**", ".claude/**", "**/.next/**", "site/**"]
  }
];

export default eslintConfig;
