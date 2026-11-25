// Verifies that `process.env.PUBLIC_*` is inlined at build time by
// react-native-dotenv (the bare-RN replacement for Expo's EXPO_PUBLIC_* vars).
const path = require('path');
const babel = require('@babel/core');

const root = path.resolve(__dirname, '..');

const code = `
const LOCAL_API = process.env.PUBLIC_LOCAL_API_URL || '';
const PUBLIC_API = process.env.PUBLIC_API_URL || '';
const WS = process.env.PUBLIC_WS_URL || '';
`;

const result = babel.transformSync(code, {
  filename: path.join(root, 'src/lib/__env_probe.ts'),
  cwd: root,
  root,
  configFile: path.join(root, 'babel.config.js'),
  babelrc: false,
});

console.log('--- transformed output ---');
console.log(result.code);

const ok =
  result.code.includes('http://10.0.2.2:3000/v1') &&
  result.code.includes('https://api.example.com/v1') &&
  !result.code.includes('process.env.PUBLIC_');

console.log(ok ? '\nPASS: env vars inlined' : '\nFAIL: env vars were NOT inlined');
process.exit(ok ? 0 : 1);
