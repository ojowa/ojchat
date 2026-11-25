// Verifies that `process.env.PUBLIC_*` is inlined at build time by
// react-native-dotenv (the bare-RN replacement for Expo's EXPO_PUBLIC_* vars).
// Reads expected values from the local .env file.
const fs = require('fs');
const path = require('path');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '..');

const envContent = fs.readFileSync(path.join(root, '.env'), 'utf8');
const env = Object.fromEntries(
  envContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'))
    .map((l) => l.split('='))
);

// Only test PUBLIC_* vars (the ones inlined at build time)
const publicVars = Object.fromEntries(
  Object.entries(env).filter(([k]) => k.startsWith('PUBLIC_'))
);

const code = Object.entries(publicVars)
  .map(([k]) => `const v_${k} = process.env.${k} || '';`)
  .join('\n');

const result = babel.transformSync(code, {
  filename: path.join(root, 'src/lib/__env_probe.ts'),
  cwd: root,
  root,
  configFile: path.join(root, 'babel.config.js'),
  babelrc: false,
});

console.log('--- transformed output ---');
console.log(result.code);

// All PUBLIC_* vars should be inlined as string literals
const ok =
  Object.values(publicVars).every((v) => result.code.includes(`"${v}"`)) &&
  !result.code.includes('process.env.PUBLIC_');

console.log(ok ? '\nPASS: env vars inlined' : '\nFAIL: env vars were NOT inlined');
process.exit(ok ? 0 : 1);
