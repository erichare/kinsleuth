import nextVitals from "eslint-config-next/core-web-vitals";

const eslintConfig = [
  ...nextVitals,
  {
    // .claude holds local git worktrees whose build artifacts must not be linted.
    ignores: [".next/**", "coverage/**", "node_modules/**", ".claude/**", "**/.next/**"]
  }
];

export default eslintConfig;
