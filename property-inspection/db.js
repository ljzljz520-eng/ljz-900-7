// 轻量 JSON 文件存储层（原子写入）
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = path.join(__dirname, 'data.json');

let data;
if (fs.existsSync(DB_FILE)) {
  data = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
} else {
  data = { employees: [], inspections: [], logs: [] };
  save();
}

function save() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, DB_FILE); // 原子替换，避免写一半损坏
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

function token() {
  return crypto.randomBytes(24).toString('hex');
}

function log(action, detail, actor) {
  data.logs.unshift({
    id: id('log'),
    action,
    detail,
    actor: actor || 'system',
    createdAt: new Date().toISOString(),
  });
  if (data.logs.length > 2000) data.logs.length = 2000; // 上限防膨胀
  save();
}

module.exports = { data, save, id, token, log };
