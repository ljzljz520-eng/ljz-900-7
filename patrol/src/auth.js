const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { DATA_DIR, db } = require('./db');

const SECRET_FILE = path.join(DATA_DIR, 'jwt.secret');
let JWT_SECRET;
try {
  JWT_SECRET = fs.readFileSync(SECRET_FILE, 'utf8').trim();
} catch {
  JWT_SECRET = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(SECRET_FILE, JWT_SECRET, { mode: 0o600 });
}

const TOKEN_ENC_KEY = crypto.createHash('sha256').update(JWT_SECRET + '::worker-token-v1').digest();

// ---------- 密码（scrypt）----------
function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
function verifyPassword(password, stored) {
  try {
    const [scheme, salt, hash] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const calc = crypto.scryptSync(String(password), salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(calc, 'hex'));
  } catch {
    return false;
  }
}

// ---------- JWT（经理 / 巡查员登录态）----------
function signSession(staff) {
  return jwt.sign({ uid: staff.id, role: staff.role, name: staff.name }, JWT_SECRET, { expiresIn: '7d' });
}
function parseToken(bearer) {
  if (!bearer || !bearer.startsWith('Bearer ')) return null;
  try { return jwt.verify(bearer.slice(7), JWT_SECRET); } catch { return null; }
}

// ---------- 员工专属 token（二维码链接）----------
function genWorkerToken() {
  // 去掉易混字符
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let out = '';
  const bytes = crypto.randomBytes(24);
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return out;
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function encryptToken(token) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', TOKEN_ENC_KEY, iv);
  const ct = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return 'gcm$' + iv.toString('hex') + '$' + cipher.getAuthTag().toString('hex') + '$' + ct.toString('hex');
}
function decryptToken(blob) {
  try {
    const [scheme, iv, tag, ct] = blob.split('$');
    if (scheme !== 'gcm') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', TOKEN_ENC_KEY, Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return Buffer.concat([decipher.update(Buffer.from(ct, 'hex')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

// ---------- 登录鉴权中间件 ----------
function authUser(req, res, next) {
  const payload = parseToken(req.headers.authorization);
  if (!payload) return res.status(401).json({ error: '未登录或登录已过期' });
  const staff = db.prepare('SELECT * FROM staff WHERE id = ?').get(payload.uid);
  if (!staff || !staff.active) return res.status(401).json({ error: '账号已停用' });
  req.user = staff;
  next();
}
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: '没有权限执行此操作' });
    }
    next();
  };
}

// ---------- 二维码 token 鉴权中间件 ----------
function authWorker(req, res, next) {
  const token = (req.query.token || req.headers['x-worker-token'] || '').trim();
  if (!token) return res.status(401).json({ error: '缺少专属链接 token' });
  const staff = db.prepare('SELECT * FROM staff WHERE token_hash = ?').get(hashToken(token));
  if (!staff) return res.status(401).json({ error: '链接无效', code: 'INVALID_TOKEN' });
  if (!staff.active) return res.status(403).json({ error: '该员工账号已停用', code: 'STAFF_DISABLED', staff: { name: staff.name, role: staff.role } });
  if (!staff.token_active) return res.status(403).json({ error: '专属链接已停用，请联系经理重新生成', code: 'TOKEN_DISABLED', staff: { name: staff.name, role: staff.role } });
  req.worker = staff;
  req.workerToken = token;
  next();
}

module.exports = {
  hashPassword, verifyPassword, signSession,
  genWorkerToken, hashToken, encryptToken, decryptToken,
  authUser, requireRole, authWorker
};
