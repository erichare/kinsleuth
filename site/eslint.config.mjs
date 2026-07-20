import { fixupConfigRules } from "@eslint/compat";
import nextVitals from "eslint-config-next/core-web-vitals";
import * as espree from "espree";

// eslint-config-next 16.2.x bundles plugins (eslint-plugin-react and friends)
// that still call rule-context APIs removed in ESLint 10 (context.getFilename
// et al.). fixupConfigRules wraps their rules in the official compatibility
// layer until eslint-config-next ships ESLint 10-native plugin versions.
const eslintConfig = [
  ...fixupConfigRules(nextVitals),
  {
    // eslint-config-next parses plain JS through Next's bundled
    // @babel/eslint-parser, whose vendored scope analyzer predates the
    // ScopeManager#addGlobals API that ESLint 10 requires. The site's plain
    // JS files (Node scripts, this config) use no Babel-only syntax, so lint
    // them with ESLint's default parser instead.
    files: ["**/*.js", "**/*.mjs", "**/*.cjs"],
    languageOptions: {
      parser: espree,
      ecmaVersion: "latest",
      sourceType: "module"
    }
  },
  {
    ignores: [".next/**", "out/**", "node_modules/**"]
  }
];

export default eslintConfig;
