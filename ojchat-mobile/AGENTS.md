# Bare React Native project

This is a bare (non-Expo) React Native project. It has native `android/` and `ios/` directories and is built/run with `npx react-native run-android` / `run-ios`.

- React Native: 0.73.6
- New Architecture (Fabric): disabled (`newArchEnabled=false`)
- Reanimated: 3.x (paper/old architecture, compatible with RN 0.73)
- Android: AGP 8.1.1, Kotlin 1.8.20, compileSdk 34, minSdk 24

## App icons (single source)
- Master: `assets/ojchat-logo.png` (replace this to change the app icon)
- Export script: `node scripts/copy-icons.js` copies to Android `mipmap-*` and iOS `AppIcon.appiconset`
- See `ASSETS.md` for full details

Do not reference Expo documentation or use Expo-specific APIs/configuration.
