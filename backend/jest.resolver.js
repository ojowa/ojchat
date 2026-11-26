const fs = require('fs');
const path = require('path');

/**
 * Jest resolver that mirrors the `paths` aliases in tsconfig.json:
 *
 *   "@app/common"        -> libs/common/src
 *   "@app/common/*"      -> libs/common/src/*
 *   "@app/database"      -> libs/database/src
 *   "@app/database/*"    -> libs/database/src/*
 *   ...
 *
 * `moduleNameMapper` cannot do this: Jest does not support regex capture
 * groups in mapper targets (`$1` is not substituted), so `@app/common/entities`
 * could never resolve. This resolver applies the same rule set explicitly.
 */
module.exports = (request, options) => {
  const match = /^@app\/([^/]+)(?:\/(.*))?$/.exec(request);
  if (!match) {
    return options.defaultResolver(request, options);
  }

  const lib = match[1];
  const subPath = match[2] ? `/${match[2]}` : '';
  const base = path.join(options.rootDir, 'libs', lib, 'src', subPath);

  const candidates = [
    path.join(base, 'index.ts'),
    path.join(base, 'index.js'),
    `${base}.ts`,
    `${base}.js`,
  ];

  for (const candidate of candidates) {
    try {
      if (fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch {
      // keep looking
    }
  }

  return options.defaultResolver(request, options);
};
