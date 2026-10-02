const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { db, UPLOAD_DIR } = require('./db');
const { hashPassword, hashToken, encryptToken } = require('./auth');

const SEED_DIR = path.join(UPLOAD_DIR, 'seed');
fs.mkdirSync(SEED_DIR, { recursive: true });

// ---------- 生成示意 SVG 图片（真实照片由用户上传）----------
function svg({ title, tag, tone, lines }) {
  const bg = tone === 'after'
    ? ['#dcfce7', '#16a34a', '#bbf7d0']
    : ['#fee2e2', '#dc2626', '#fecaca'];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600" viewBox="0 0 800 600">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${bg[0]}"/>
      <stop offset="100%" stop-color="${bg[2]}"/>
    </linearGradient>
  </defs>
  <rect width="800" height="600" fill="url(#g)"/>
  <rect x="40" y="40" width="720" height="120" rx="16" fill="${bg[1]}" opacity="0.92"/>
  <text x="400" y="92" font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="40" font-weight="700" fill="#fff" text-anchor="middle">${tag}</text>
  <text x="400" y="140" font-family="sans-serif" font-size="26" fill="#fff" text-anchor="middle">${title}</text>
  <g font-family="PingFang SC, Microsoft YaHei, sans-serif" font-size="28" fill="#1f2937">
    ${lines.map((t, i) => `<text x="80" y="${260 + i * 52}">${tone === 'after' ? '✅' : '⚠️'} ${t}</text>`).join('\n    ')}
  </g>
  <text x="400" y="540" font-family="sans-serif" font-size="20" fill="#6b7280" text-anchor="middle">巡查整改系统 · 示例图片（可被真实上传照片替换）</text>
</svg>`;
}
function writeSvg(name, data) {
  const rel = path.join('seed', name).split(path.sep).join('/');
  fs.writeFileSync(path.join(SEED_DIR, name), data, 'utf8');
  return rel;
}

function run() {
  const count = db.prepare('SELECT COUNT(*) c FROM staff').get().c;
  if (count > 0) return;

  const now = () => new Date().toISOString().replace('T', ' ').slice(0, 19);
  const insStaff = db.prepare(`INSERT INTO staff (username, password_hash, name, role, phone, active, token_hash, token_cipher, token_active, token_updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, 1, ?, ?, 1, ?, ?)`);

  function addStaff(username, pwd, name, role, phone, token) {
    const r = insStaff.run(
      username || null,
      username ? hashPassword(pwd) : null,
      name, role, phone,
      token ? hashToken(token) : null,
      token ? encryptToken(token) : null,
      now(), now()
    );
    return r.lastInsertRowid;
  }

  // 固定演示 token（仅首次初始化时写入，实际使用请在经理端重新生成）
  const managerId = addStaff('manager', 'manager123', '周经理', 'manager', '13800000001', null);
  const inspectorId = addStaff('inspector', 'inspect123', '林巡查', 'inspector', '13800000002', null);
  const wangId = addStaff(null, null, '王桂芳', 'cleaner', '13900001001', 'WANG-GF-SEED-TOKEN-2026-AAAA');
  const liuId = addStaff(null, null, '刘大勇', 'repairer', '13900001002', 'LIU-DY-SEED-TOKEN-2026-BBBB');
  const zhaoId = addStaff(null, null, '赵美琴', 'cleaner', '13900001003', 'ZHAO-MQ-SEED-TOKEN-2026-CCCC');

  const insIssue = db.prepare(`INSERT INTO issues
    (code, location_type, location_detail, description, points, status, inspector_id, assignee_id, due_at, submitted_at, submitted_note, reviewed_by, reviewed_at, review_note, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insPhoto = db.prepare(`INSERT INTO photos (issue_id, kind, filename, content_type, size, uploaded_by, created_at)
    VALUES (?, ?, ?, 'image/svg+xml', 0, ?, ?)`);
  const insLog = db.prepare(`INSERT INTO logs (actor_id, actor_name, action, target, detail, ip, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`);

  function addIssue(o) {
    const created = o.created || now();
    const r = insIssue.run(
      o.code, o.loc, o.detail, o.desc, o.points, o.status,
      inspectorId, o.assignee,
      o.due || null, o.submitted || null, o.submitNote || '',
      o.status === 'approved' || o.status === 'rejected' ? managerId : null,
      o.reviewed || null, o.reviewNote || '',
      created, o.updated || created
    );
    const id = r.lastInsertRowid;
    const beforeRel = writeSvg(`issue${id}-before.svg`, svg({
      tag: '整改前', title: o.detail, tone: 'before', lines: o.beforeLines
    }));
    insPhoto.run(id, 'before', beforeRel, inspectorId, created);
    if (o.afterLines) {
      const afterRel = writeSvg(`issue${id}-after.svg`, svg({
        tag: '整改后', title: o.detail, tone: 'after', lines: o.afterLines
      }));
      insPhoto.run(id, 'after', afterRel, o.assignee, o.submitted || created);
    }
    return id;
  }

  const addLog = (actorId, actorName, action, target, detail, t) =>
    insLog.run(actorId, actorName, action, target, detail, '127.0.0.1', t);

  db.transaction(() => {
    addIssue({
      code: 'P20260928-001', loc: 'elevator_hall', detail: '3栋1单元电梯厅',
      desc: '地面有明显烟头与纸屑，墙面有小广告残留', points: 3, status: 'approved',
      assignee: wangId, created: '2026-09-28 09:10:00', due: '2026-09-29 09:10:00',
      submitted: '2026-09-28 15:20:00', submitNote: '已清扫地面，铲除小广告',
      reviewed: '2026-09-28 16:00:00', reviewNote: '整改到位',
      beforeLines: ['地面散落烟头、纸屑', '墙面残留小广告胶痕'],
      afterLines: ['地面已清扫干净', '小广告已铲除并擦净']
    });
    addIssue({
      code: 'P20260928-002', loc: 'garbage_room', detail: '2栋垃圾房',
      desc: '垃圾桶满溢，地面有渗滤液，异味明显', points: 3, status: 'approved',
      assignee: wangId, created: '2026-09-28 10:05:00', due: '2026-09-29 10:05:00',
      submitted: '2026-09-28 17:40:00', submitNote: '垃圾已清运，地面冲洗消毒',
      reviewed: '2026-09-29 08:30:00', reviewNote: '合格，注意保持',
      beforeLines: ['垃圾桶满溢', '地面有渗滤液、异味大'],
      afterLines: ['桶位清空并消杀', '地面冲洗无积液']
    });
    addIssue({
      code: 'P20260929-003', loc: 'elevator_hall', detail: '5栋2单元电梯厅',
      desc: '照明灯不亮（2盏）', points: 2, status: 'approved',
      assignee: liuId, created: '2026-09-29 08:50:00', due: '2026-09-30 08:50:00',
      submitted: '2026-09-29 14:00:00', submitNote: '已更换灯管并测试',
      reviewed: '2026-09-29 15:10:00', reviewNote: '',
      beforeLines: ['吸顶灯 2 盏不亮', '厅内光线昏暗'],
      afterLines: ['灯管已更换', '照明恢复正常']
    });
    addIssue({
      code: 'P20260930-004', loc: 'corridor', detail: '6栋3层楼道',
      desc: '楼道堆放废纸箱，消防通道受阻', points: 2, status: 'approved',
      assignee: wangId, created: '2026-09-30 11:00:00', due: '2026-10-01 11:00:00',
      submitted: '2026-09-30 16:30:00', submitNote: '纸箱已联系业主搬离',
      reviewed: '2026-10-01 09:00:00', reviewNote: '',
      beforeLines: ['废纸箱堆放占用通道', '存在消防隐患'],
      afterLines: ['杂物全部清走', '通道畅通']
    });
    addIssue({
      code: 'P20261001-005', loc: 'garbage_room', detail: '1栋垃圾房',
      desc: '排污管堵塞导致地面积水', points: 4, status: 'approved',
      assignee: liuId, created: '2026-10-01 09:20:00', due: '2026-10-02 09:20:00',
      submitted: '2026-10-01 11:10:00', submitNote: '管道已疏通，积水排净',
      reviewed: '2026-10-01 14:00:00', reviewNote: '处理及时',
      beforeLines: ['排污管堵塞', '地面积水约 2cm'],
      afterLines: ['管道疏通', '积水排净并清洁']
    });
    addIssue({
      code: 'P20261001-006', loc: 'elevator_hall', detail: '2栋1单元电梯厅',
      desc: '天花板渗水，墙皮脱落', points: 6, status: 'rejected',
      assignee: liuId, created: '2026-10-01 15:00:00', due: '2026-10-02 15:00:00',
      submitted: '2026-10-01 18:00:00', submitNote: '先补了墙皮',
      reviewed: '2026-10-02 08:40:00', reviewNote: '渗水点未做防水处理，请排查水源后重新提交整改照',
      beforeLines: ['天花板有渗水痕迹', '墙皮鼓包脱落'],
      afterLines: ['仅表面补墙', '渗水源头未处理']
    });
    addIssue({
      code: 'P20261002-007', loc: 'corridor', detail: '4栋2层楼道',
      desc: '楼梯扶手积灰，窗台垃圾未清', points: 2, status: 'submitted',
      assignee: zhaoId, created: '2026-10-02 08:30:00', due: '2026-10-03 08:30:00',
      submitted: '2026-10-02 10:10:00', submitNote: '扶手已擦拭，窗台已清理',
      beforeLines: ['扶手积灰明显', '窗台有饮料瓶'],
      afterLines: ['扶手擦拭干净', '窗台垃圾已清']
    });
    addIssue({
      code: 'P20261002-008', loc: 'garbage_room', detail: '7栋垃圾房',
      desc: '垃圾桶周边散落垃圾，异味重', points: 3, status: 'pending',
      assignee: wangId, created: '2026-10-02 09:00:00', due: '2026-10-03 09:00:00',
      beforeLines: ['桶边散落生活垃圾', '异味较重，有蝇虫']
    });
    addIssue({
      code: 'P20261002-009', loc: 'corridor', detail: '8栋5层楼道',
      desc: '声控灯故障，夜间楼道不亮', points: 4, status: 'pending',
      assignee: liuId, created: '2026-10-02 09:20:00', due: '2026-10-02 18:00:00',
      beforeLines: ['声控灯无响应', '夜间通行存在安全隐患']
    });
    addIssue({
      code: 'P20261002-010', loc: 'elevator_hall', detail: '9栋1单元电梯厅',
      desc: '楼层按键面板松动', points: 1, status: 'pending',
      assignee: liuId, created: '2026-10-02 10:00:00', due: '2026-10-03 10:00:00',
      beforeLines: ['按键面板翘起松动', '存在脱落风险']
    });

    addLog(managerId, '周经理', '登录成功', '周经理', '', '2026-09-28 08:30:00');
    addLog(inspectorId, '林巡查', '创建问题单', 'P20260928-001', '电梯厅 / 指派 王桂芳 / 扣 3 分', '2026-09-28 09:10:00');
    addLog(wangId, '王桂芳', '提交整改', 'P20260928-001', '2 张整改照', '2026-09-28 15:20:00');
    addLog(managerId, '周经理', '审核通过', 'P20260928-001', '整改到位', '2026-09-28 16:00:00');
    addLog(inspectorId, '林巡查', '创建问题单', 'P20261001-006', '电梯厅 / 指派 刘大勇 / 扣 6 分', '2026-10-01 15:00:00');
    addLog(liuId, '刘大勇', '提交整改', 'P20261001-006', '先补了墙皮', '2026-10-01 18:00:00');
    addLog(managerId, '周经理', '审核驳回', 'P20261001-006', '渗水点未做防水处理', '2026-10-02 08:40:00');
    addLog(managerId, '周经理', '停用员工链接', '（演示说明）', '此动作可在员工管理中操作', '2026-10-02 08:45:00');
  })();

  console.log('✓ 已写入演示数据');
  console.log('  经理:     manager / manager123');
  console.log('  巡查员:   inspector / inspect123');
  console.log('  保洁/维修: 扫描员工管理中的专属二维码进入');
}

run();
