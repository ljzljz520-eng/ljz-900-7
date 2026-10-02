const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authUser, requireRole } = require('../auth');

router.get('/', authUser, requireRole('manager'), (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(10, parseInt(req.query.page_size, 10) || 30));
  const where = [];
  const args = [];
  const action = String(req.query.action || '');
  const keyword = String(req.query.keyword || '').trim();
  if (action) { where.push('action = ?'); args.push(action); }
  if (keyword) { where.push('(actor_name LIKE ? OR target LIKE ? OR detail LIKE ?)'); args.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`); }
  const whereSql = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const total = db.prepare(`SELECT COUNT(*) c FROM logs ${whereSql}`).get(...args).c;
  const logs = db.prepare(`SELECT * FROM logs ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(...args, pageSize, (page - 1) * pageSize);
  const actions = db.prepare('SELECT DISTINCT action FROM logs ORDER BY action').all().map(r => r.action);
  res.json({ logs, total, page, page_size: pageSize, actions });
});

router.get('/export', authUser, requireRole('manager'), (req, res) => {
  const rows = db.prepare('SELECT * FROM logs ORDER BY id DESC LIMIT 5000').all();
  const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lines = ['时间,操作人,动作,对象,详情,IP'];
  for (const r of rows) {
    lines.push([r.created_at, r.actor_name, r.action, r.target, r.detail, r.ip].map(esc).join(','));
  }
  const csv = '﻿' + lines.join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="logs.csv"');
  res.send(csv);
});

module.exports = router;
