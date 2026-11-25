module.exports = {
  root: true,
  extends: ['universe/native'],
  rules: {
    'react-hooks/exhaustive-deps': 'warn',
    'no-console': ['warn', { allow: ['warn', 'error'] }],
  },
  overrides: [
    {
      // Node-side tooling (Metro/Babel/Jest config, build scripts)
      files: ['*.js', 'scripts/**/*.js', '__mocks__/**/*.js'],
      env: { node: true },
    },
    {
      files: ['tests/**/*.ts', '**/*.test.ts', '**/*.test.tsx'],
      env: { jest: true },
      rules: {
        'no-console': 'off',
      },
    },
  ],
};
