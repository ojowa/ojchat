module.exports = {
  presets: ['metro-react-native-babel-preset'],
  plugins: [
    ['babel-plugin-module-resolver', {
      root: ['./src'],
      extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    }],
  ],
};
