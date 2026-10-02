const express = require('express');
const path = require('path');
const jwt = require('jsonwebtoken');
const fs = require('fs');
const { db, UPLOAD_DIR } = require('./src/db');
const { log } = require('./src/logger');
const { hashToken } = require('./src/auth');
const JWT_SECRET = fs.readFileSync(path.join(__dirname, 'data', 'jwt.secret'), 'utf8').trim();

const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---------- API 路由 ----------
app.use('/api/auth', require('./src/routes/auth'));
app.use('/api/issues', require('./src/routes/issues'));
app.use('/api/staff', require('./src/routes/staff'));
app.use('/api/logs', require('./src/routes/logs'));
app.use('/api/w', require('./src/routes/worker'));

// ---------- 图片访问（登录用户，支持 query access_token 供 <img> 使用）----------
app.get('/api/photos/:id', (req, res) => {
  let user = null;
  const bearer = req.headers.authorization;
  const queryToken = req.query.access_token;
  try {
    if (bearer && bearer.startsWith('Bearer ')) user = jwt.verify(bearer.slice(7), JWT_SECRET);
  } catch { user = null; }
  if (!user && queryToken) {
    try { user = jwt.verify(String(queryToken), JWT_SECRET); } catch { user = null; }
  }
  if (!user) return res.status(401).send('Unauthorized');
  const photo = db.prepare('SELECT * FROM photos WHERE id=?').get(parseInt(req.params.id, 10));
  if (!photo) return res.status(404).send('Not found');
  if (user.role === 'inspector') {
    const issue = db.prepare('SELECT inspector_id FROM issues WHERE id=?').get(photo.issue_id);
    if (!issue || issue.inspector_id !== user.uid) return res.status(403).send('Forbidden');
  }
  servePhoto(res, photo);
});

// ---------- 图片访问（整改人员，token 必须属于该单的指派人）----------
app.get('/api/w/photos/:id', (req, res) => {
  const token = String(req.query.token || '');
  if (!token) return res.status(401).send('Unauthorized');
  const worker = db.prepare('SELECT * FROM staff WHERE token_hash=?').get(hashToken(token));
  if (!worker || !worker.active || !worker.token_active) return res.status(403).send('Forbidden');
  const photo = db.prepare('SELECT * FROM photos WHERE id=?').get(parseInt(req.params.id, 10));
  if (!photo) return res.status(404).send('Not found');
  const issue = db.prepare('SELECT assignee_id FROM issues WHERE id=?').get(photo.issue_id);
  if (!issue || issue.assignee_id !== worker.id) return res.status(403).send('Forbidden');
  servePhoto(res, photo);
});

function servePhoto(res, photo) {
  const rel = String(photo.filename).replace(/\\/g, '/');
  if (rel.includes('..') || path.isAbsolute(rel)) return res.status(400).send('Bad path');
  const file = path.normalize(path.join(UPLOAD_DIR, rel));
  if (!file.startsWith(path.normalize(UPLOAD_DIR) + path.sep)) return res.status(400).send('Bad path');
  if (!fs.existsSync(file)) return res.status(404).send('文件不存在');
  res.setHeader('Content-Type', photo.content_type || 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=3600');
  fs.createReadStream(file).pipe(res);
}

// ---------- 页面 ----------
app.use(express.static(path.join(__dirname, 'public')));
const PAGE_DIR = path.join(__dirname, 'public');
app.get('/', (req, res) => res.sendFile(path.join(PAGE_DIR, 'login.html')));
app.get('/inspector', (req, res) => res.sendFile(path.join(PAGE_DIR, 'inspector.html')));
app.get('/manager', (req, res) => res.sendFile(path.join(PAGE_DIR, 'manager.html')));
app.get('/w/:token', (req, res) => res.sendFile(path.join(PAGE_DIR, 'worker.html')));

// ---------- 错误处理（multer 等）----------
app.use((err, req, res, next) => {
  const msg = err && err.message ? err.message : '服务器错误';
  if (err && err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: '单张图片不能超过 10MB' });
  if (err && err.code === 'LIMIT_FILE_COUNT') return res.status(400).json({ error: '最多上传 6 张图片' });
  console.error(err);
  res.status(400).json({ error: msg });
});

const PORT = process.env.PORT || 3000;

// 初始化种子数据
require('./src/seed');
log({ actor: '系统', action: '服务启动', target: `端口 ${PORT}` });

app.listen(PORT, () => {
  console.log(`\n物业公区巡查整改系统已启动: http://localhost:${PORT}`);
});
