const { db } = require('./db');

const insert = db.prepare(`
  INSERT INTO logs (actor_id, actor_name, action, target, detail, ip, created_at)
  VALUES (?, ?, ?, ?, ?, ?, datetime('now','localtime'))
`);

function log({ actor, action, target = '', detail = '', ip = '' }) {
  const actorId = actor && actor.id ? actor.id : null;
  const actorName = actor && actor.name ? actor.name
    : (typeof actor === 'string' ? actor : '系统');
  const detailStr = typeof detail === 'string' ? detail : JSON.stringify(detail);
  insert.run(actorId, actorName, action, String(target), detailStr, ip);
}

module.exports = { log };
