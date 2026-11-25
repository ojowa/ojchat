module.exports = {
  preset: 'react-native',
  moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
  testPathIgnorePatterns: ['/node_modules/', '/e2e/'],
  collectCoverageFrom: [
    'src/services/crypto/**/*.{ts,tsx}',
    'src/store/**/*.{ts,tsx}',
    'src/services/api/**/*.{ts,tsx}',
  ],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?(react-native|@react-native|@react-navigation|@stablelib|@notifee|@op-engineering|react-native-vector-icons|react-native-image-picker|react-native-image-resizer|react-native-audio-recorder-player|react-native-fs|react-native-linear-gradient|react-native-keychain|react-native-mmkv|react-native-get-random-values)))',
  ],
  moduleNameMapper: {
    '^react-native/setup-env$': '<rootDir>/__mocks__/setup-env.js',
  },
};
