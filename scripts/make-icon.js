const sharp = require('sharp');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');

const SIZE = 1024;
const LOGO_PATH = path.join(__dirname, '../src/renderer/assets/logo.png');
const OUT_DIR = path.join(__dirname, '../build');
const ICON_PNG = path.join(OUT_DIR, 'icon.png');
const ICONSET_DIR = path.join(OUT_DIR, 'icon.iconset');
const ICNS_PATH = path.join(OUT_DIR, 'icon.icns');

fs.mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  // Scale logo to fit with padding, invert to white on dark square
  const padding = Math.round(SIZE * 0.18);
  const targetW = SIZE - padding * 2;
  const targetH = Math.round(targetW * (288 / 1756));

  const logo = await sharp(LOGO_PATH)
    .resize(targetW, targetH, { fit: 'contain' })
    .negate({ alpha: false })
    .toBuffer();

  const top = Math.round((SIZE - targetH) / 2);

  await sharp({
    create: {
      width: SIZE,
      height: SIZE,
      channels: 4,
      background: { r: 10, g: 10, b: 10, alpha: 1 },
    },
  })
    .composite([{ input: logo, top, left: padding }])
    .png()
    .toFile(ICON_PNG);

  console.log(`icon.png written`);

  // Generate .icns via iconset (macOS only)
  if (process.platform !== 'darwin') {
    console.log('Skipping .icns (macOS only)');
    return;
  }

  fs.mkdirSync(ICONSET_DIR, { recursive: true });

  const sizes = [16, 32, 64, 128, 256, 512, 1024];
  for (const s of sizes) {
    const isRetina = s > 512;
    const logicalSize = isRetina ? s / 2 : s;
    const suffix = isRetina ? `@2x` : '';
    const name = `icon_${logicalSize}x${logicalSize}${suffix}.png`;
    await sharp(ICON_PNG).resize(s, s).toFile(path.join(ICONSET_DIR, name));
    // Also write the non-retina variants for 32 and 128 at double size
    if (!isRetina && s <= 512 && s * 2 <= SIZE) {
      const name2x = `icon_${s}x${s}@2x.png`;
      await sharp(ICON_PNG).resize(s * 2, s * 2).toFile(path.join(ICONSET_DIR, name2x));
    }
  }

  execSync(`iconutil -c icns "${ICONSET_DIR}" -o "${ICNS_PATH}"`);
  fs.rmSync(ICONSET_DIR, { recursive: true });
  console.log(`icon.icns written`);
}

main().catch((err) => { console.error(err); process.exit(1); });
