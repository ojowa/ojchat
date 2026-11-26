const { getDefaultConfig } = require('@react-native/metro-config');

module.exports = (async () => {
  const config = await getDefaultConfig(__dirname);
  config.resolver.sourceExts.push('mjs');
  config.resolver.blockList = new RegExp(
    `${config.resolver.blockList.source}|[/\\\\]\\.cxx([/\\\\]|$)`,
    'i',
  );
  return config;
})();
