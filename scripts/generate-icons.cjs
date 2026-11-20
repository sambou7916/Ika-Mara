const fs = require('fs');
const path = require('path');

// Minimal valid PNG buffer generator (single blue pixel scaled or PNG header)
const minimalPngBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzkUvj6QAAAABJRU5ErkJggg==';
const buffer = Buffer.from(minimalPngBase64, 'base64');

const iconsDir = path.join(__dirname, '..', 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), buffer);
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), buffer);
console.log('Icons generated successfully.');
