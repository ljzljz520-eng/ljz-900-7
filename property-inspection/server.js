const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const QRCode = require('qrcode');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');

// 区域类型与扣分规则
const AREA_TYPES = {
  elevator: { label: '电梯厅', deduction: 2 },
  corridor: { label: '楼道',   deduction: 3 },
  garbage:  { label: '垃圾房', deduction: 5 },
};
const ROLES = { cleaner: '保洁', repairer: '维修' };

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOAD_DIR));

// ---------- 文件上传 ----------
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = (path.extname(file.originalname) || '.jpg').toLowerCase();
    cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/^image\//.test(file.mimetype)) cb(null, true);
    else cb(new Error('只允许上传图片文件'));
  },
});

const areaLabel = (t) => (AREA_TYPES[t] || {}).label || t;
const now = () => new Date().toISOString();
const decorate = (i) => ({ ...i, areaLabel: areaLabel(i.areaType) });
const removeFile = (file) => { if (file) fs.unlink(file.path, () => {}); };
const staffUrl = (req, emp) => `${req.protocol}://${req.get('host')}/staff.html?token=${emp.token}`;

// ---------- 巡查员端 ----------
app.post('/api/inspections', upload.single('photo'), (req, res) => {
  const { areaType, location, description, inspector } = req.body;
  if (!req.file) return res.status(400).json({ error: '请上传问题照片' });
  if (!AREA_TYPES[areaType]) { removeFile(req.file); return res.status(400).json({ error: '区域类型无效' }); }
  if (!location || !location.trim()) { removeFile(req.file); return res.status(400).json({ error: '请填写具体位置' }); }

  const insp = {
    id: db.id('insp'),
    areaType,
    location: location.trim(),
    description: (description || '').trim(),
    inspector: (inspector || '').trim() || '匿名巡查员',
    photo: '/uploads/' + req.file.filename,
    deduction: AREA_TYPES[areaType].deduction,
    status: 'pending',
    rectification: null,
    createdAt: now(),
  };
  db.data.inspections.unshift(insp);
  db.log('CREATE_INSPECTION', `${insp.inspector} 上报【${areaLabel(areaType)}】${insp.location}，扣 ${insp.deduction} 分`, insp.inspector);
  db.save();
  res.json({ ok: true, inspection: decorate(insp) });
});

app.get('/api/inspections', (req, res) => {
  let list = db.data.inspections;
  if (req.query.status) list = list.filter((i) => i.status === req.query.status);
  res.json(list.map(decorate));
});

// ---------- 员工端（token 链接） ----------
function findEmployeeByToken(token) {
  return db.data.employees.find((e) => e.token === token);
}

app.get('/api/staff/:token', (req, res) => {
  const emp = findEmployeeByToken(req.params.token);
  if (!emp) {
    db.log('ACCESS_DENIED', `无效 token 访问员工端 (${String(req.params.token).slice(0, 8)}…)`, 'anonymous');
    return res.status(404).json({ error: '链接无效，请联系管理员获取新二维码' });
  }
  if (!emp.active) {
    db.log('ACCESS_DENIED', `已停用链接被访问：${emp.name}`, emp.name);
    return res.status(403).json({ error: '该链接已被停用，请联系经理重新开通' });
  }
  const pending = db.data.inspections.filter((i) => i.status === 'pending').map(decorate);
  const done = db.data.inspections
    .filter((i) => i.rectification && i.rectification.employeeId === emp.id)
    .map(decorate);
  res.json({
    employee: { id: emp.id, name: emp.name, role: emp.role, roleLabel: ROLES[emp.role] || emp.role },
    pending,
    done,
  });
});

app.post('/api/staff/:token/rectify/:id', upload.single('photo'), (req, res) => {
  const emp = findEmployeeByToken(req.params.token);
  if (!emp) { removeFile(req.file); return res.status(404).json({ error: '链接无效' }); }
  if (!emp.active) {
    removeFile(req.file);
    db.log('ACCESS_DENIED', `已停用链接尝试提交整改：${emp.name}`, emp.name);
    return res.status(403).json({ error: '该链接已被停用' });
  }
  const insp = db.data.inspections.find((i) => i.id === req.params.id);
  if (!insp) { removeFile(req.file); return res.status(404).json({ error: '整改任务不存在' }); }
  if (insp.status === 'rectified') { removeFile(req.file); return res.status(409).json({ error: '该问题已被整改，请刷新页面' }); }
  if (!req.file) return res.status(400).json({ error: '请上传整改后的照片' });

  insp.status = 'rectified';
  insp.rectification = {
    photo: '/uploads/' + req.file.filename,
    note: (req.body.note || '').trim(),
    employeeId: emp.id,
    employeeName: emp.name,
    rectifiedAt: now(),
  };
  db.log('RECTIFY', `${emp.name}（${ROLES[emp.role]}）整改【${areaLabel(insp.areaType)}】${insp.location}`, emp.name);
  db.save();
  res.json({ ok: true, inspection: decorate(insp) });
});

// ---------- 经理看板 ----------
app.get('/api/manager/summary', (req, res) => {
  const all = db.data.inspections;
  const pending = all.filter((i) => i.status === 'pending');
  const rectified = all.filter((i) => i.status === 'rectified');
  res.json({
    stats: {
      total: all.length,
      pending: pending.length,
      rectified: rectified.length,
      pendingDeduction: pending.reduce((s, i) => s + i.deduction, 0),
      totalDeduction: all.reduce((s, i) => s + i.deduction, 0),
      rate: all.length ? Math.round((rectified.length / all.length) * 100) : 0,
    },
    inspections: all.map(decorate),
  });
});

// ---------- 管理端：员工 / token / 日志 ----------
app.get('/api/admin/employees', (req, res) => {
  res.json(db.data.employees.map((e) => ({
    id: e.id, name: e.name, role: e.role, roleLabel: ROLES[e.role] || e.role,
    active: e.active, createdAt: e.createdAt, staffUrl: staffUrl(req, e),
  })));
});

app.post('/api/admin/employees', (req, res) => {
  const { name, role } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '请填写员工姓名' });
  if (!ROLES[role]) return res.status(400).json({ error: '角色必须是 cleaner 或 repairer' });
  const emp = {
    id: db.id('emp'),
    name: name.trim(),
    role,
    token: db.token(),
    active: true,
    createdAt: now(),
  };
  db.data.employees.push(emp);
  db.log('CREATE_EMPLOYEE', `新增员工 ${emp.name}（${ROLES[role]}）并生成专属链接`, 'admin');
  db.save();
  res.json({ ok: true, employee: { ...emp, roleLabel: ROLES[role], staffUrl: staffUrl(req, emp) } });
});

app.post('/api/admin/employees/:id/regenerate-token', (req, res) => {
  const emp = db.data.employees.find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: '员工不存在' });
  emp.token = db.token();
  db.log('REGENERATE_TOKEN', `重新生成 ${emp.name} 的专属链接，旧链接立即失效`, 'admin');
  db.save();
  res.json({ ok: true, staffUrl: staffUrl(req, emp) });
});

app.post('/api/admin/employees/:id/toggle-active', (req, res) => {
  const emp = db.data.employees.find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).json({ error: '员工不存在' });
  emp.active = !emp.active;
  db.log(emp.active ? 'ENABLE_EMPLOYEE' : 'DISABLE_EMPLOYEE',
    `${emp.active ? '启用' : '停用'} ${emp.name} 的专属链接`, 'admin');
  db.save();
  res.json({ ok: true, active: emp.active });
});

app.get('/api/admin/employees/:id/qrcode.png', (req, res) => {
  const emp = db.data.employees.find((e) => e.id === req.params.id);
  if (!emp) return res.status(404).end();
  res.type('png');
  QRCode.toFileStream(res, staffUrl(req, emp), { width: 240, margin: 1 });
});

app.get('/api/admin/logs', (req, res) => {
  res.json(db.data.logs.slice(0, 200));
});

// ---------- 全局错误处理 ----------
app.use((err, req, res, next) => {
  if (err) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? '图片不能超过 10MB' : (err.message || '服务器错误');
    return res.status(400).json({ error: msg });
  }
  next();
});

// ---------- 首次运行写入演示员工 ----------
if (db.data.employees.length === 0) {
  for (const [name, role] of [['王保洁', 'cleaner'], ['李维修', 'repairer']]) {
    db.data.employees.push({ id: db.id('emp'), name, role, token: db.token(), active: true, createdAt: now() });
  }
  db.log('INIT', '系统初始化：创建演示员工 王保洁 / 李维修', 'system');
  db.save();
}

app.listen(PORT, () => console.log(`物业公区巡查整改系统已启动: http://localhost:${PORT}`));
