const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authUser, hashPassword, verifyPassword, signSession } = require('../auth');
const { log } = require('../logger');

router.post('/login', (req, res) => {
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (!username || !password) return res.status(400).json({ error: '请输入账号和密码' });
  const staff = db.prepare('SELECT * FROM staff WHERE username = ?').get(username);
  if (!staff || !staff.password_hash || !verifyPassword(password, staff.password_hash)) {
    log({ actor: username, action: '登录失败', target: username, ip: req.ip });
    return res.status(401).json({ error: '账号或密码错误' });
  }
  if (!staff.active) return res.status(403).json({ error: '账号已停用，请联系管理员' });
  if (!['manager', 'inspector'].includes(staff.role)) {
    return res.status(403).json({ error: '保洁/维修人员无需登录，请使用专属二维码进入整改页面' });
  }
  const token = signSession(staff);
  log({ actor: staff, action: '登录成功', target: staff.name, ip: req.ip });
  res.json({
    token,
    user: { id: staff.id, name: staff.name, role: staff.role, username: staff.username }
  });
});

router.get('/me', authUser, (req, res) => {
  const u = req.user;
  res.json({ id: u.id, name: u.name, role: u.role, username: u.username });
});

router.post('/logout', authUser, (req, res) => {
  log({ actor: req.user, action: '退出登录', target: req.user.name, ip: req.ip });
  res.json({ ok: true });
});

module.exports = router;
