module.exports = {
  presets: ['module:metro-react-native-babel-preset'],
  plugins: [
    // Loads .env / .env.local / .env.<mode> and inlines `process.env.<KEY>`
    // at build time (this is what Expo used to do for EXPO_PUBLIC_* vars).
    ['module:react-native-dotenv', { path: '.env', moduleName: '@env' }],
    // React Native 0.73's Metro preset only ships the class-properties
    // transform; newer deps (e.g. @tanstack/query-core v5.10x) use class
    // private *methods* (#foo()), which need their own transform.
    ['@babel/plugin-transform-private-methods', { loose: true }],
    ['@babel/plugin-transform-private-property-in-object', { loose: true }],
    ['babel-plugin-module-resolver', {
      root: ['./src'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    }],
  ],
};
