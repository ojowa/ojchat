# App Icons — Single Source of Truth

## Master icon
- **`assets/ojchat-logo.png`** — the single source image used by both Android and iOS.
- Recommended size: **1024 × 1024 px** PNG (square, no transparency issues on corners).

## Platform outputs (generated from `assets/icon.png`)

### Android
`android/app/src/main/res/mipmap-{density}/ic_launcher.png`  
`android/app/src/main/res/mipmap-{density}/ic_launcher_round.png`

| Folder | Density | ic_launcher | ic_launcher_round |
|--------|---------|-------------|-------------------|
| mipmap-mdpi | 1× | 48 × 48 | 48 × 48 |
| mipmap-hdpi | 1.5× | 72 × 72 | 72 × 72 |
| mipmap-xhdpi | 2× | 96 × 96 | 96 × 96 |
| mipmap-xxhdpi | 3× | 144 × 144 | 144 × 144 |
| mipmap-xxxhdpi | 4× | 192 × 192 | 192 × 192 |

Referenced in `AndroidManifest.xml`:
```xml
android:icon="@mipmap/ic_launcher"
android:roundIcon="@mipmap/ic_launcher_round"
```

### iOS
`ios/OjchatApp/Images.xcassets/AppIcon.appiconset/`

Required sizes (see `Contents.json`):
- 20×20 @2x, @3x
- 29×29 @2x, @3x
- 40×40 @2x, @3x
- 60×60 @2x, @3x
- 1024 × 1024 @1x (App Store / marketing)

Referenced in `Info.plist` via the default `AppIcon` appiconset.

## How to update the icon

1. Replace `assets/icon.png` with your new artwork (1024 × 1024 PNG).
2. Run the export script to copy it to both platforms:
   ```bash
   node scripts/copy-icons.js
   ```
3. Rebuild:
   ```bash
   npx react-native run-android   # Android
   # or open ios/OjchatApp.xcworkspace in Xcode            # iOS
   ```

> ⚠️ The copy script does **not** resize. You must provide correctly sized PNGs for each density/size, or use an image editor (or `sharp`/`imagemagick`) to generate them before running the script.
