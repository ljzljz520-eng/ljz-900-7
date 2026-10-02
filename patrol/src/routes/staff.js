const express = require('express');
const QRCode = require('qrcode');
const router = express.Router();
const { db } = require('../db');
const { authUser, requireRole, hashPassword, genWorkerToken, hashToken, encryptToken, decryptToken } = require('../auth');
const { computeBadges } = require('../badges');
const { log } = require('../logger');

function publicStaff(s) {
  let link = null;
  if (s.role === 'cleaner' || s.role === 'repairer') {
    link = {
      active: !!s.token_active,
      updated_at: s.token_updated_at,
      has_token: !!s.token_hash
    };
    // 经理端需要展示/下载二维码：解密回明文 token
    if (s.token_hash && s.token_cipher) {
      const token = decryptToken(s.token_cipher);
      if (token) link.url = `/w/${token}`;
    }
  }
  return {
    id: s.id, username: s.username, name: s.name, role: s.role,
    phone: s.phone || '', active: !!s.active, created_at: s.created_at, link
  };
}

// 列表（经理看全员含徽章；巡查员只看可指派的保洁/维修人员）
router.get('/', authUser, (req, res) => {
  if (req.user.role === 'manager') {
    const rows = db.prepare('SELECT * FROM staff ORDER BY role, id').all();
    const data = rows.map(s => {
      if (s.role === 'cleaner' || s.role === 'repairer') {
        const { stats, badges } = computeBadges(s.id);
        return { ...publicStaff(s), stats, badges };
      }
      return publicStaff(s);
    });
    return res.json({ staff: data });
  }
  const rows = db.prepare("SELECT id, name, role, phone FROM staff WHERE role IN ('cleaner','repairer') AND active=1 ORDER BY role, name").all();
  res.json({ staff: rows });
});

// 新建员工（经理）
router.post('/', authUser, requireRole('manager'), (req, res) => {
  const name = String(req.body.name || '').trim();
  const role = String(req.body.role || '');
  const phone = String(req.body.phone || '').trim().slice(0, 30);
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!name) return res.status(400).json({ error: '请填写姓名' });
  if (!['manager', 'inspector', 'cleaner', 'repairer'].includes(role)) return res.status(400).json({ error: '角色无效' });
  if (!['cleaner', 'repairer'].includes(role) && !username) return res.status(400).json({ error: '经理/巡查员需要登录账号' });
  if (username && !/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
    return res.status(400).json({ error: '登录账号需为 3-30 位字母/数字/下划线' });
  }
  if (username) {
    if (db.prepare('SELECT id FROM staff WHERE username=?').get(username)) {
      return res.status(400).json({ error: '登录账号已存在' });
    }
    if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  }
  const r = db.prepare(`INSERT INTO staff (username, password_hash, name, role, phone, active, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, 1, datetime('now','localtime'), ?)`)
    .run(username || null, username ? hashPassword(password) : null, name, role, phone, req.user.id);
  log({ actor: req.user, action: '新建员工', target: name, detail: `角色：${role}`, ip: req.ip });
  res.json({ ok: true, staff: publicStaff(db.prepare('SELECT * FROM staff WHERE id=?').get(r.lastInsertRowid)) });
});

// 重新生成专属 token（旧链接立即失效）
router.post('/:id/regenerate-token', authUser, requireRole('manager'), async (req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE id=?').get(parseInt(req.params.id, 10));
  if (!s) return res.status(404).json({ error: '员工不存在' });
  if (!['cleaner', 'repairer'].includes(s.role)) return res.status(400).json({ error: '仅保洁/维修人员有专属链接' });
  let token;
  for (let i = 0; i < 5; i++) {
    token = genWorkerToken();
    if (!db.prepare('SELECT id FROM staff WHERE token_hash=?').get(hashToken(token))) break;
  }
  db.prepare(`UPDATE staff SET token_hash=?, token_cipher=?, token_active=1, token_updated_at=datetime('now','localtime') WHERE id=?`)
    .run(hashToken(token), encryptToken(token), s.id);
  const url = `/w/${token}`;
  const qr = await QRCode.toDataURL(`${req.protocol}://${req.get('host')}${url}`, { width: 320, margin: 1 });
  log({ actor: req.user, action: '重新生成token', target: s.name, detail: '旧链接已失效', ip: req.ip });
  res.json({ ok: true, token, url, qr, staff: publicStaff(db.prepare('SELECT * FROM staff WHERE id=?').get(s.id)) });
});

// 停用 / 启用专属链接
router.post('/:id/token-status', authUser, requireRole('manager'), (req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE id=?').get(parseInt(req.params.id, 10));
  if (!s) return res.status(404).json({ error: '员工不存在' });
  if (!s.token_hash) return res.status(400).json({ error: '该员工还没有专属链接' });
  const active = !!req.body.active;
  db.prepare('UPDATE staff SET token_active=? WHERE id=?').run(active ? 1 : 0, s.id);
  log({
    actor: req.user,
    action: active ? '启用员工链接' : '停用员工链接',
    target: s.name, detail: active ? '链接恢复可用' : '扫码后将无法进入整改页', ip: req.ip
  });
  res.json({ ok: true, staff: publicStaff(db.prepare('SELECT * FROM staff WHERE id=?').get(s.id)) });
});

// 停用 / 启用账号
router.post('/:id/active', authUser, requireRole('manager'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare('SELECT * FROM staff WHERE id=?').get(id);
  if (!s) return res.status(404).json({ error: '员工不存在' });
  const active = !!req.body.active;
  if (!active && id === req.user.id) return res.status(400).json({ error: '不能停用自己的账号' });
  db.prepare('UPDATE staff SET active=?, token_active=CASE WHEN ?=1 THEN token_active ELSE 0 END WHERE id=?')
    .run(active ? 1 : 0, active ? 1 : 0, id);
  log({ actor: req.user, action: active ? '启用账号' : '停用账号', target: s.name, ip: req.ip });
  res.json({ ok: true, staff: publicStaff(db.prepare('SELECT * FROM staff WHERE id=?').get(id)) });
});

// 重置登录密码
router.post('/:id/reset-password', authUser, requireRole('manager'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const s = db.prepare('SELECT * FROM staff WHERE id=?').get(id);
  if (!s) return res.status(404).json({ error: '员工不存在' });
  if (!s.username) return res.status(400).json({ error: '该员工无登录账号（使用二维码进入）' });
  const password = String(req.body.password || '');
  if (password.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  db.prepare('UPDATE staff SET password_hash=?, active=1 WHERE id=?').run(hashPassword(password), id);
  log({ actor: req.user, action: '重置密码', target: s.name, ip: req.ip });
  res.json({ ok: true });
});

// 查看现有专属二维码（不更换 token）
router.get('/:id/qr', authUser, requireRole('manager'), async (req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE id=?').get(parseInt(req.params.id, 10));
  if (!s) return res.status(404).json({ error: '员工不存在' });
  if (!s.token_hash || !s.token_cipher) return res.status(400).json({ error: '该员工还没有专属链接，请先生成' });
  const token = decryptToken(s.token_cipher);
  if (!token) return res.status(500).json({ error: '链接解析失败，请重新生成' });
  const url = `/w/${token}`;
  const qr = await QRCode.toDataURL(`${req.protocol}://${req.get('host')}${url}`, { width: 320, margin: 1 });
  res.json({ url, qr, active: !!s.token_active && !!s.active });
});

// 员工徽章明细
router.get('/:id/badges', authUser, requireRole('manager'), (req, res) => {
  const s = db.prepare('SELECT * FROM staff WHERE id=?').get(parseInt(req.params.id, 10));
  if (!s) return res.status(404).json({ error: '员工不存在' });
  res.json({ staff: { id: s.id, name: s.name, role: s.role }, ...computeBadges(s.id) });
});

module.exports = router;
