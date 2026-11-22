/* 一次性素材处理：统一长边 1400、JPEG q82，避免官网首屏拖慢 */
const path = require('path');
const fs = require('fs');
const sharp = require('C:/Users/张东阳/Desktop/TxxT/node_modules/sharp');

const dir = path.resolve(__dirname, '../public/images');
const files = fs.readdirSync(dir).filter((f) => /\.(jpe?g|png)$/i.test(f));

(async () => {
  for (const file of files) {
    const input = path.join(dir, file);
    const out = path.join(dir, file.replace(/\.(jpe?g|png)$/i, '.jpg'));
    const tmp = out + '.tmp';
    await sharp(input)
      .rotate()
      .resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(tmp);
    fs.renameSync(tmp, out);
    if (input !== out) fs.unlinkSync(input);
    console.log(path.basename(out), Math.round(fs.statSync(out).size / 1024) + 'KB');
  }
})();
