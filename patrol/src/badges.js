const { db } = require('./db');

const LOCATIONS = [
  { key: 'elevator_hall', label: '电梯厅', icon: '🛗' },
  { key: 'corridor', label: '楼道', icon: '🚪' },
  { key: 'garbage_room', label: '垃圾房', icon: '🗑️' }
];
const LOCATION_MAP = Object.fromEntries(LOCATIONS.map(l => [l.key, l]));

function locationLabel(key) { return LOCATION_MAP[key] ? LOCATION_MAP[key].label : key; }

// 扣分徽章（核心）：按累计扣分分级
function penaltyBadge(totalPoints) {
  if (totalPoints <= 0) return { level: 'clean', name: '满分卫士', emoji: '💚', color: '#16a34a' };
  if (totalPoints <= 5) return { level: 'blue', name: '轻微提醒', emoji: '🔵', color: '#2563eb' };
  if (totalPoints <= 10) return { level: 'yellow', name: '黄牌警示', emoji: '🟡', color: '#ca8a04' };
  if (totalPoints <= 20) return { level: 'red', name: '红牌警告', emoji: '🔴', color: '#dc2626' };
  return { level: 'black', name: '重点督办', emoji: '⬛', color: '#1f2937' };
}

function workerStats(workerId) {
  const s = db.prepare(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status='approved' THEN 1 ELSE 0 END) AS approved,
      SUM(CASE WHEN status='submitted' THEN 1 ELSE 0 END) AS submitted,
      SUM(CASE WHEN status='rejected' THEN 1 ELSE 0 END) AS rejected,
      SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status='approved' THEN points ELSE 0 END) AS points,
      SUM(CASE WHEN status IN ('approved','submitted','rejected') THEN 1 ELSE 0 END) AS handled,
      SUM(CASE WHEN submitted_at IS NOT NULL AND due_at IS NOT NULL AND submitted_at <= due_at THEN 1 ELSE 0 END) AS ontime,
      SUM(CASE WHEN status='pending' AND due_at IS NOT NULL AND due_at < datetime('now') THEN 1 ELSE 0 END) AS overdue
    FROM issues WHERE assignee_id = ?
  `).get(workerId) || {};
  return {
    total: s.total || 0, approved: s.approved || 0, submitted: s.submitted || 0,
    rejected: s.rejected || 0, pending: s.pending || 0, points: s.points || 0,
    handled: s.handled || 0, ontime: s.ontime || 0, overdue: s.overdue || 0
  };
}

// 计算员工完整徽章列表（扣分徽章 + 附加徽章）
function computeBadges(workerId) {
  const st = workerStats(workerId);
  const badges = [penaltyBadge(st.points)];

  const handledWithSubmission = db.prepare(`
    SELECT COUNT(*) c FROM issues
    WHERE assignee_id=? AND submitted_at IS NOT NULL AND due_at IS NOT NULL
  `).get(workerId).c;
  if (handledWithSubmission >= 2 && st.ontime === handledWithSubmission) {
    badges.push({ level: 'lightning', name: '准时之星', emoji: '⚡', color: '#7c3aed' });
  }
  if (st.overdue >= 2) {
    badges.push({ level: 'clock', name: '超时较多', emoji: '⏰', color: '#ea580c' });
  }
  // 高频点位徽章（单点位累计 >=3 单）
  const hot = db.prepare(`
    SELECT location_type, COUNT(*) c FROM issues
    WHERE assignee_id=? GROUP BY location_type HAVING c >= 3
    ORDER BY c DESC
  `).all(workerId);
  for (const h of hot) {
    const loc = LOCATION_MAP[h.location_type];
    badges.push({ level: 'hotspot', name: `${loc.label}高频`, emoji: loc.icon, color: '#0891b2' });
  }
  if (st.handled >= 5 && st.total > 0 && st.approved / st.handled >= 0.9) {
    badges.push({ level: 'star', name: '一次通过率高', emoji: '🌟', color: '#d97706' });
  }
  return { stats: st, badges };
}

module.exports = { LOCATIONS, LOCATION_MAP, locationLabel, penaltyBadge, workerStats, computeBadges };
