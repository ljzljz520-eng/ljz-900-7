const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { UPLOAD_DIR } = require('./db');

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
const EXT = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const storage = multer.diskStorage({
  destination(req, file, cb) {
    const now = new Date();
    const sub = path.join(
      String(now.getFullYear()),
      String(now.getMonth() + 1).padStart(2, '0')
    );
    const dir = path.join(UPLOAD_DIR, sub);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    const ext = EXT[file.mimetype] || '.jpg';
    cb(null, now() + ext);
  }
});
function now() {
  return Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
}

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024, files: 6 },
  fileFilter(req, file, cb) {
    if (ALLOWED.has(file.mimetype)) cb(null, true);
    else cb(new Error('仅支持 JPG / PNG / WEBP / GIF 图片'));
  }
});

// 磁盘上文件相对 uploads 的路径 -> 数据库存储值
function relPath(absDir, filename) {
  return path.relative(UPLOAD_DIR, path.join(absDir, filename)).split(path.sep).join('/');
}

module.exports = { upload, relPath, UPLOAD_DIR };
