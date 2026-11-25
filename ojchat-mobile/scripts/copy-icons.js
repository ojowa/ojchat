const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'ojchat-logo.png');

if (!fs.existsSync(SRC)) {
  console.error(`❌ Source icon not found: ${SRC}`);
  process.exit(1);
}

// ---------- Android ----------
const androidMipmapDirs = [
  'android/app/src/main/res/mipmap-mdpi',
  'android/app/src/main/res/mipmap-hdpi',
  'android/app/src/main/res/mipmap-xhdpi',
  'android/app/src/main/res/mipmap-xxhdpi',
  'android/app/src/main/res/mipmap-xxxhdpi',
];

for (const dir of androidMipmapDirs) {
  const fullDir = path.join(ROOT, dir);
  fs.mkdirSync(fullDir, { recursive: true });

  // ic_launcher.png
  fs.copyFileSync(SRC, path.join(fullDir, 'ic_launcher.png'));
  // ic_launcher_round.png (same source; you can replace with a round variant later)
  fs.copyFileSync(SRC, path.join(fullDir, 'ic_launcher_round.png'));

  console.log(`✅ Android ${path.basename(fullDir)}: ic_launcher.png + ic_launcher_round.png`);
}

// ---------- iOS ----------
const iosIconDir = path.join(ROOT, 'ios', 'OjchatApp', 'Images.xcassets', 'AppIcon.appiconset');
fs.mkdirSync(iosIconDir, { recursive: true });

// iOS needs specific sizes; we copy the master as a placeholder.
// Replace these with correctly resized PNGs before releasing.
const iosSizes = [
  { size: '20x20', scale: '2x', name: 'Icon-20@2x.png' },
  { size: '20x20', scale: '3x', name: 'Icon-20@3x.png' },
  { size: '29x29', scale: '2x', name: 'Icon-29@2x.png' },
  { size: '29x29', scale: '3x', name: 'Icon-29@3x.png' },
  { size: '40x40', scale: '2x', name: 'Icon-40@2x.png' },
  { size: '40x40', scale: '3x', name: 'Icon-40@3x.png' },
  { size: '60x60', scale: '2x', name: 'Icon-60@2x.png' },
  { size: '60x60', scale: '3x', name: 'Icon-60@3x.png' },
  { size: '1024x1024', scale: '1x', name: 'Icon-1024.png' },
];

for (const s of iosSizes) {
  fs.copyFileSync(SRC, path.join(iosIconDir, s.name));
  console.log(`✅ iOS: ${s.name} (${s.size} @${s.scale})`);
}

console.log('\n✨ Done. Replace the copied PNGs with correctly resized versions as needed.');
