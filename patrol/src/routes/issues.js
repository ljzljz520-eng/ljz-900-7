const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authUser, requireRole } = require('../auth');
const { upload, relPath } = require('../upload');
const { log } = require('../logger');
const { LOCATION_MAP } = require('../badges');

const STATUSES = ['pending', 'submitted', 'approved', 'rejected'];

function nextIssueCode() {
  const d = new Date();
  const ymd = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const prefix = `P${ymd}-`;
  const row = db.prepare("SELECT COUNT(*) c FROM issues WHERE code LIKE ?").get(prefix + '%');
  return prefix + String(row.c + 1).padStart(3, '0');
}

function issueById(id) {
  return db.prepare(`
    SELECT i.*,
      insp.name AS inspector_name,
      a.name AS assignee_name, a.role AS assignee_role,
      r.name AS reviewer_name
    FROM issues i
    JOIN staff insp ON insp.id = i.inspector_id
    JOIN staff a ON a.id = i.assignee_id
    LEFT JOIN staff r ON r.id = i.reviewed_by
    WHERE i.id = ?
  `).get(id);
}

function decorate(issue, viewerId) {
  const photos = db.prepare('SELECT id, kind, filename, content_type, size, created_at FROM photos WHERE issue_id = ? ORDER BY id').all(issue.id);
  const before = photos.filter(p => p.kind === 'before');
  const after = photos.filter(p => p.kind === 'after');
  return {
    ...issue,
    location_label: LOCATION_MAP[issue.location_type] ? LOCATION_MAP[issue.location_type].label : issue.location_type,
    status_label: { pending: '待整改', submitted: '待审核', approved: '已通过', rejected: '已驳回' }[issue.status],
    photos: photos.map(p => ({ ...p, url: `/api/photos/${p.id}` })),
    before: before.map(p => ({ ...p, url: `/api/photos/${p.id}` })),
    after: after.map(p => ({ ...p, url: `/api/photos/${p.id}` }))
  };
}

// 创建问题单（巡查员）
router.post('/', authUser, requireRole('inspector', 'manager'), upload.array('photos', 6), (req, res) => {
  const files = req.files || [];
  if (files.length < 1) return res.status(400).json({ error: '请至少上传 1 张问题照片' });
  const locationType = String(req.body.location_type || '');
  if (!LOCATION_MAP[locationType]) return res.status(400).json({ error: '请选择点位类型' });
  const assigneeId = parseInt(req.body.assignee_id, 10);
  const assignee = db.prepare("SELECT * FROM staff WHERE id=? AND role IN ('cleaner','repairer') AND active=1").get(assigneeId);
  if (!assignee) return res.status(400).json({ error: '请选择有效的整改人员' });
  const points = Math.max(1, Math.min(20, parseInt(req.body.points, 10) || 1));
  const locationDetail = String(req.body.location_detail || '').trim().slice(0, 100);
  const description = String(req.body.description || '').trim().slice(0, 500);
  const dueHours = Math.max(1, Math.min(720, parseInt(req.body.due_hours, 10) || 48));

  const code = nextIssueCode();
  const result = db.prepare(`
    INSERT INTO issues (code, location_type, location_detail, description, points, inspector_id, assignee_id, due_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now','localtime','+' || ? || ' hours'), datetime('now','localtime'), datetime('now','localtime'))
  `).run(code, locationType, locationDetail, description, points, req.user.id, assignee.id, dueHours);

  const issueId = result.lastInsertRowid;
  const insPhoto = db.prepare(`INSERT INTO photos (issue_id, kind, filename, content_type, size, uploaded_by, created_at)
    VALUES (?, 'before', ?, ?, ?, ?, datetime('now','localtime'))`);
  for (const f of files) {
    insPhoto.run(issueId, relPath(f.destination, f.filename), f.mimetype, f.size, req.user.id);
  }
  log({
    actor: req.user, action: '创建问题单', target: code,
    detail: `${LOCATION_MAP[locationType].label} / 指派 ${assignee.name} / 扣 ${points} 分 / ${files.length} 张照片 / 限期 ${dueHours} 小时`,
    ip: req.ip
  });
  res.json({ ok: true, issue: decorate(issueById(issueId)) });
});

// 列表
router.get('/', authUser, (req, res) => {
  const { status, location_type, assignee_id, mine } = req.query;
  const where = [];
  const args = [];
  if (STATUSES.includes(status)) { where.push('i.status = ?'); args.push(status); }
  if (LOCATION_MAP[location_type]) { where.push('i.location_type = ?'); args.push(location_type); }
  if (assignee_id) { where.push('i.assignee_id = ?'); args.push(parseInt(assignee_id, 10)); }
  if (mine === '1') where.push('i.assignee_id = ?'), args.push(req.user.id);
  if (req.user.role === 'inspector') { where.push('i.inspector_id = ?'); args.push(req.user.id); }
  const sql = `
    SELECT i.*, insp.name AS inspector_name, a.name AS assignee_name, a.role AS assignee_role, r.name AS reviewer_name,
      (SELECT COUNT(*) FROM photos p WHERE p.issue_id=i.id AND p.kind='before') AS before_count,
      (SELECT COUNT(*) FROM photos p WHERE p.issue_id=i.id AND p.kind='after') AS after_count
    FROM issues i
    JOIN staff insp ON insp.id = i.inspector_id
    JOIN staff a ON a.id = i.assignee_id
    LEFT JOIN staff r ON r.id = i.reviewed_by
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY i.id DESC LIMIT 300`;
  const rows = db.prepare(sql).all(...args).map(r => ({
    ...r,
    location_label: LOCATION_MAP[r.location_type].label,
    status_label: { pending: '待整改', submitted: '待审核', approved: '已通过', rejected: '已驳回' }[r.status]
  }));
  res.json({ issues: rows });
});

// 详情
router.get('/:id', authUser, (req, res) => {
  const issue = issueById(parseInt(req.params.id, 10));
  if (!issue) return res.status(404).json({ error: '问题单不存在' });
  if (req.user.role === 'inspector' && issue.inspector_id !== req.user.id) {
    return res.status(403).json({ error: '只能查看自己创建的问题单' });
  }
  res.json({ issue: decorate(issue) });
});

// 经理审核
router.post('/:id/review', authUser, requireRole('manager'), (req, res) => {
  const id = parseInt(req.params.id, 10);
  const issue = issueById(id);
  if (!issue) return res.status(404).json({ error: '问题单不存在' });
  if (issue.status !== 'submitted') return res.status(400).json({ error: '当前状态不可审核' });
  const action = String(req.body.action || '');
  if (!['approve', 'reject'].includes(action)) return res.status(400).json({ error: '审核动作无效' });
  const note = String(req.body.review_note || '').trim().slice(0, 300);
  const newStatus = action === 'approve' ? 'approved' : 'rejected';
  db.prepare(`UPDATE issues SET status=?, review_note=?, reviewed_by=?, reviewed_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`)
    .run(newStatus, note, req.user.id, id);
  log({
    actor: req.user,
    action: action === 'approve' ? '审核通过' : '审核驳回',
    target: issue.code,
    detail: `整改人 ${issue.assignee_name}；${note || '（无备注）'}`,
    ip: req.ip
  });
  res.json({ ok: true, issue: decorate(issueById(id)) });
});

module.exports = router;
