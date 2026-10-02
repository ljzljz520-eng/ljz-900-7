const express = require('express');
const router = express.Router();
const { db } = require('../db');
const { authWorker } = require('../auth');
const { upload, relPath } = require('../upload');
const { log } = require('../logger');
const { LOCATION_MAP } = require('../badges');

function workerIssue(id, workerId) {
  return db.prepare(`
    SELECT i.*, insp.name AS inspector_name, a.name AS assignee_name
    FROM issues i
    JOIN staff insp ON insp.id = i.inspector_id
    JOIN staff a ON a.id = i.assignee_id
    WHERE i.id=? AND i.assignee_id=?
  `).get(id, workerId);
}
function decorateW(issue, token) {
  const photos = db.prepare('SELECT id, kind, filename, created_at FROM photos WHERE issue_id=? ORDER BY id').all(issue.id);
  return {
    ...issue,
    location_label: LOCATION_MAP[issue.location_type].label,
    status_label: { pending: '待整改', submitted: '待审核', approved: '已通过', rejected: '已驳回' }[issue.status],
    photos: photos.map(p => ({ ...p, url: `/api/w/photos/${p.id}?token=${encodeURIComponent(token)}` })),
    before: photos.filter(p => p.kind === 'before').map(p => ({ ...p, url: `/api/w/photos/${p.id}?token=${encodeURIComponent(token)}` })),
    after: photos.filter(p => p.kind === 'after').map(p => ({ ...p, url: `/api/w/photos/${p.id}?token=${encodeURIComponent(token)}` }))
  };
}

// 个人信息 + 任务概览
router.get('/me', authWorker, (req, res) => {
  const w = req.worker;
  const st = db.prepare(`
    SELECT
      COUNT(*) total,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) pending,
      SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) submitted,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) approved,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) rejected,
      SUM(CASE WHEN status='approved' THEN points ELSE 0 END) points,
      SUM(CASE WHEN status='pending' AND due_at IS NOT NULL AND due_at < datetime('now') THEN 1 ELSE 0 END) overdue
    FROM issues WHERE assignee_id=?
  `).get(w.id);
  res.json({
    worker: { id: w.id, name: w.name, role: w.role, phone: w.phone || '' },
    stats: {
      total: st.total || 0, pending: st.pending || 0, submitted: st.submitted || 0,
      approved: st.approved || 0, rejected: st.rejected || 0, points: st.points || 0,
      overdue: st.overdue || 0
    }
  });
});

// 我的任务列表（被驳回的可重新提交）
router.get('/issues', authWorker, (req, res) => {
  
  const rows = db.prepare(`
    SELECT i.*, insp.name AS inspector_name,
      (SELECT COUNT(*) FROM photos p WHERE p.issue_id=i.id AND p.kind='before') before_count,
      (SELECT COUNT(*) FROM photos p WHERE p.issue_id=i.id AND p.kind='after') after_count
    FROM issues i JOIN staff insp ON insp.id=i.inspector_id
    WHERE i.assignee_id=? AND i.status IN ('pending','submitted','rejected')
    ORDER BY (i.due_at IS NOT NULL AND i.due_at < datetime('now') AND i.status='pending') DESC,
             CASE i.status WHEN 'pending' THEN 0 WHEN 'rejected' THEN 1 ELSE 2 END, i.id DESC
  `).all(req.worker.id);
  res.json({ issues: rows.map(r => ({
    ...r,
    location_label: LOCATION_MAP[r.location_type].label,
    status_label: { pending: '待整改', submitted: '待审核', approved: '已通过', rejected: '已驳回' }[r.status]
  })) });
});

router.get('/issues/:id', authWorker, (req, res) => {
  
  const issue = workerIssue(parseInt(req.params.id, 10), req.worker.id);
  if (!issue) return res.status(404).json({ error: '任务不存在' });
  res.json({ issue: decorateW(issue, req.workerToken) });
});

// 提交整改照（支持驳回后再次提交：替换旧 after 照）
router.post('/issues/:id/submit', authWorker, upload.array('photos', 6), (req, res) => {
  const files = req.files || [];
  if (files.length < 1) return res.status(400).json({ error: '请至少上传 1 张整改完成照片' });
  const issue = workerIssue(parseInt(req.params.id, 10), req.worker.id);
  if (!issue) return res.status(404).json({ error: '任务不存在' });
  if (!['pending', 'rejected'].includes(issue.status)) {
    return res.status(400).json({ error: '当前状态下不能提交整改' });
  }
  const note = String(req.body.note || '').trim().slice(0, 300);
  const tx = db.transaction(() => {
    // 重新提交时移除旧整改照文件记录（文件本身保留在磁盘，仅断开关联）
    db.prepare("DELETE FROM photos WHERE issue_id=? AND kind='after'").run(issue.id);
    const ins = db.prepare(`INSERT INTO photos (issue_id, kind, filename, content_type, size, uploaded_by, created_at)
      VALUES (?, 'after', ?, ?, ?, ?, datetime('now','localtime'))`);
    for (const f of files) ins.run(issue.id, relPath(f.destination, f.filename), f.mimetype, f.size, req.worker.id);
    db.prepare(`UPDATE issues SET status='submitted', submitted_at=datetime('now','localtime'), submitted_note=?,
      reviewed_by=NULL, reviewed_at=NULL, review_note='', updated_at=datetime('now','localtime') WHERE id=?`)
      .run(note, issue.id);
  });
  tx();
  log({
    actor: req.worker, action: '提交整改', target: issue.code,
    detail: `${files.length} 张整改照${issue.status === 'rejected' ? '（驳回后重新提交）' : ''}${note ? '；' + note : ''}`,
    ip: req.ip
  });
  
  res.json({ ok: true, issue: decorateW(workerIssue(issue.id, req.worker.id), req.workerToken) });
});

module.exports = router;
