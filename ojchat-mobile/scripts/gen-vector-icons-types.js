// Generates src/types/react-native-vector-icons.d.ts from the shipped glyphmap.
// react-native-vector-icons v10 does not bundle TypeScript declarations, so we
// generate a typed module for the Ionicons set (the only one this app uses).
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const glyphmapPath = path.join(
  root,
  'node_modules/react-native-vector-icons/glyphmaps/Ionicons.json',
);
const outPath = path.join(root, 'src/types/react-native-vector-icons.d.ts');

const glyphMap = JSON.parse(fs.readFileSync(glyphmapPath, 'utf8'));
const names = Object.keys(glyphMap).sort();

const entries = names.map((name) => `    ${JSON.stringify(name)}: number;`).join('\n');

const contents = `// AUTO-GENERATED from node_modules/react-native-vector-icons/glyphmaps/Ionicons.json
// Run \`npm run gen:vector-icons-types\` to regenerate.
declare module 'react-native-vector-icons/Ionicons' {
  import { ReactElement } from 'react';
  import { TextProps } from 'react-native';

  export const glyphMap: {
${entries}
  };

  export type IoniconsGlyphs = keyof typeof glyphMap;

  export interface IoniconsProps extends TextProps {
    name: IoniconsGlyphs;
    size?: number;
    color?: string;
    style?: TextProps['style'];
  }

  const Ionicons: ((props: IoniconsProps) => ReactElement | null) & {
    glyphMap: typeof glyphMap;
    hasIcon(name: string): boolean;
    getRawGlyphMap(): typeof glyphMap;
    getFontFamily(): string | undefined;
    loadFont(): Promise<void>;
  };

  export default Ionicons;
}
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, contents, 'utf8');
console.log(`Wrote ${outPath} with ${names.length} glyph names.`);
