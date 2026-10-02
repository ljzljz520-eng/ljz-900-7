requireRole('manager');
let allStaffCache = [];

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => switchTab(t.dataset.tab)));
function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  ['review', 'all', 'staff', 'logs'].forEach(k => document.getElementById('tab-' + k).hidden = k !== tab);
  if (tab === 'review') loadReview();
  if (tab === 'all') loadAll();
  if (tab === 'staff') loadStaff();
  if (tab === 'logs') loadLogs();
}

/* ================= 审核 ================= */
async function loadReview() {
  const { issues } = await api('/api/issues');
  const c = k => issues.filter(x => x.status === k).length;
  const approvedPts = issues.filter(x => x.status === 'approved').reduce((s, x) => s + x.points, 0);
  const overdue = issues.filter(x => x.status === 'pending' && x.due_at && x.due_at < nowSql()).length;
  document.getElementById('reviewStats').innerHTML = `
    <div class="stat-card info"><div class="icon">⏳</div><div class="num">${c('submitted')}</div><div class="label">待我审核</div></div>
    <div class="stat-card warn"><div class="icon">🧹</div><div class="num">${c('pending')}</div><div class="label">整改中${overdue ? `（${overdue} 单超时）` : ''}</div></div>
    <div class="stat-card ok"><div class="icon">✅</div><div class="num">${c('approved')}</div><div class="label">已通过</div></div>
    <div class="stat-card danger"><div class="icon">⬇️</div><div class="num">${approvedPts}</div><div class="label">累计扣分（已生效）</div></div>`;

  const waiting = issues.filter(x => x.status === 'submitted');
  const reviewed = issues.filter(x => ['approved', 'rejected'].includes(x.status)).slice(0, 10);
  const rl = document.getElementById('reviewList');
  rl.innerHTML = waiting.length ? waiting.map(i => reviewCard(i, true)).join('')
    : '<div class="empty"><div class="big">✨</div>所有提交都已审核完毕</div>';
  document.getElementById('reviewedList').innerHTML = reviewed.length ? reviewed.map(i => reviewCard(i, false)).join('')
    : '<div class="empty small">暂无审核记录</div>';
}
function reviewCard(i, actionable) {
  return `<div class="issue-card">
    <div class="issue-head">
      <span class="code">${esc(i.code)}</span>${locTag(i.location_type)}${statusPill(i.status)}
      ${i.status === 'pending' && i.due_at && i.due_at < nowSql() ? '<span class="overdue-tag">⏰ 已超时</span>' : ''}
      <span class="spacer"></span><span class="points-tag">扣 ${i.points} 分</span>
    </div>
    <div class="issue-body">
      <div><b>${esc(i.location_detail)}</b></div>
      ${i.description ? `<div class="issue-desc">${esc(i.description)}</div>` : ''}
      <div class="issue-meta">
        <span>👤 整改人：${esc(i.assignee_name)}（${i.assignee_role === 'cleaner' ? '保洁' : '维修'}）</span>
        <span>📷 问题照 ${i.before_count} 张 → 整改照 ${i.after_count} 张</span>
        <span>🕒 提交：${fmtTime(i.submitted_at)}</span>
      </div>
      ${i.submitted_note ? `<div class="note-box">整改说明：${esc(i.submitted_note)}</div>` : ''}
      ${i.status === 'rejected' ? `<div class="reject-box">驳回原因：${esc(i.review_note || '—')}</div>` : ''}
      <div class="issue-foot">
        <button class="btn sm" onclick="reviewIssue(${i.id})">🔍 ${actionable ? '查看配对照片并审核' : '查看配对照片'}</button>
      </div>
    </div>
  </div>`;
}
window.reviewIssue = async function (id) {
  const { issue: i } = await api('/api/issues/' + id);
  openModal(`
    <h2>${esc(i.code)} · 配对对比 ${statusPill(i.status)}</h2>
    <dl class="kv" style="margin-bottom:6px">
      <dt>点位</dt><dd>${i.location_label} · ${esc(i.location_detail)}</dd>
      <dt>问题</dt><dd>${esc(i.description || '—')}</dd>
      <dt>整改人</dt><dd>${esc(i.assignee_name)}（${i.assignee_role === 'cleaner' ? '保洁' : '维修'}） <span id="mbadges"></span></dd>
      <dt>扣分</dt><dd class="points-tag">${i.points} 分</dd>
      <dt>时限</dt><dd>${fmtTime(i.due_at)}　提交：${fmtTime(i.submitted_at)}${i.submitted_at && i.due_at ? (i.submitted_at <= i.due_at ? '　<span style="color:#16a34a">按时</span>' : '　<span style="color:#dc2626">超时</span>') : ''}</dd>
      <dt>说明</dt><dd>${esc(i.submitted_note || '—')}</dd>
    </dl>
    ${i.after.length
      ? compareBlock(photoUrl(i.before[0]), photoUrl(i.after[0]))
      : '<div class="note-box">整改人尚未提交整改照片，无配对对比图。</div>'}
    <div style="margin-top:8px">
      <div class="pair-label before">整改前（${i.before.length} 张）</div>${thumbsHtml(i.before, 'before')}
      ${i.after.length ? `<div class="pair-label after">整改后（${i.after.length} 张）</div>${thumbsHtml(i.after, 'after')}` : ''}
    </div>
    ${i.status === 'submitted' ? `
    <div class="divider"></div>
    <div class="field"><label>审核备注（驳回时建议写明原因）</label>
      <textarea id="rvNote" maxlength="300" placeholder="如：合格 / 渗水源头未处理请重新整改…"></textarea></div>
    <div class="modal-foot">
      <button class="btn danger" id="rvReject">❌ 驳回，要求重新整改</button>
      <button class="btn" id="rvApprove">✅ 审核通过</button>
    </div>` : (i.review_note ? `<div class="${i.status === 'rejected' ? 'reject-box' : 'note-box'}">审核备注：${esc(i.review_note)}（审核于 ${fmtTime(i.reviewed_at)}）</div>` : '')}
  `, { wide: true });
  // 加载整改人徽章
  api(`/api/staff/${i.assignee_id}/badges`).then(r => {
    document.getElementById('mbadges').innerHTML = badgesHtml(r.badges);
  }).catch(() => {});
  if (i.status === 'submitted') {
    document.getElementById('rvApprove').onclick = () => doReview(id, 'approve');
    document.getElementById('rvReject').onclick = () => {
      if (!document.getElementById('rvNote').value.trim() && !confirm('未填写驳回原因，确认驳回？')) return;
      doReview(id, 'reject');
    };
  }
};
async function doReview(id, action) {
  const note = document.getElementById('rvNote').value.trim();
  if (action === 'reject' && !note) return toast('驳回时请填写原因', 'err');
  try {
    await api(`/api/issues/${id}/review`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, review_note: note })
    });
    closeModal();
    toast(action === 'approve' ? '已审核通过，扣分计入徽章' : '已驳回，整改人可重新提交', 'ok');
    loadReview();
  } catch (err) { toast(err.message, 'err'); }
}

/* ================= 全部问题单 ================= */
async function loadAll() {
  const [{ issues }, { staff }] = await Promise.all([api('/api/issues'), api('/api/staff')]);
  allStaffCache = staff.filter(s => ['cleaner', 'repairer'].includes(s.role));
  const sel = document.getElementById('allAssignee');
  if (!sel.options.length) {
    sel.innerHTML = '<option value="">全部整改人</option>' + allStaffCache.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('');
  }
  const st = document.getElementById('allStatus').value;
  const loc = document.getElementById('allLoc').value;
  const asg = sel.value;
  const rows = issues.filter(i => (!st || i.status === st) && (!loc || i.location_type === loc) && (!asg || String(i.assignee_id) === asg));
  const box = document.getElementById('allList');
  box.innerHTML = rows.length ? rows.map(i => `
    <div class="issue-card">
      <div class="issue-head">
        <span class="code">${esc(i.code)}</span>${locTag(i.location_type)}${statusPill(i.status)}
        ${i.status === 'pending' && i.due_at && i.due_at < nowSql() ? '<span class="overdue-tag">⏰ 已超时</span>' : ''}
        <span class="spacer"></span><span class="points-tag">扣 ${i.points} 分</span>
      </div>
      <div class="issue-body">
        <b>${esc(i.location_detail)}</b>${i.description ? ` — ${esc(i.description)}` : ''}
        <div class="issue-meta">
          <span>巡查：${esc(i.inspector_name)}</span><span>整改：${esc(i.assignee_name)}</span>
          <span>问题照 ${i.before_count} / 整改照 ${i.after_count}</span><span>创建 ${fmtTime(i.created_at)}</span>
        </div>
        <div style="margin-top:8px"><button class="btn secondary sm" onclick="reviewIssue(${i.id})">查看详情</button></div>
      </div>
    </div>`).join('') : '<div class="empty">没有符合条件的问题单</div>';
}
['allStatus', 'allLoc'].forEach(id => document.getElementById(id).addEventListener('change', loadAll));
document.getElementById('allAssignee').addEventListener('change', loadAll);

/* ================= 员工 / 二维码管理 ================= */
async function loadStaff() {
  const { staff } = await api('/api/staff');
  const workers = staff.filter(s => ['cleaner', 'repairer'].includes(s.role));
  const office = staff.filter(s => ['manager', 'inspector'].includes(s.role));
  document.getElementById('workerGrid').innerHTML = workers.map(workerCard).join('');
  document.getElementById('officeTable').innerHTML = `
    <tr><th>姓名</th><th>角色</th><th>账号</th><th>电话</th><th>状态</th><th>操作</th></tr>
    ${office.map(s => `<tr>
      <td>${esc(s.name)}</td>
      <td>${s.role === 'manager' ? '经理' : '巡查员'}</td>
      <td><code>${esc(s.username || '')}</code></td>
      <td>${esc(s.phone || '')}</td>
      <td>${s.active ? '<span class="link-on">在职</span>' : '<span class="link-off">已停用</span>'}</td>
      <td><button class="btn secondary sm" onclick="resetPwd(${s.id},'${esc(s.name)}')">重置密码</button></td>
    </tr>`).join('')}`;
}
function workerCard(s) {
  const st = s.stats || {};
  return `<div class="staff-card">
    <div class="staff-head">
      <div class="avatar">${esc(s.name[0])}</div>
      <div>
        <div class="staff-name">${esc(s.name)} <span class="small muted">${s.role === 'cleaner' ? '🧹 保洁' : '🔧 维修'}</span></div>
        <div class="staff-sub">📞 ${esc(s.phone || '未填写')} · 任务 ${st.total || 0} · 通过 ${st.approved || 0} · 扣分 <b style="color:#dc2626">${st.points || 0}</b></div>
      </div>
    </div>
    <div style="margin-top:10px">${badgesHtml(s.badges)}</div>
    <div style="margin-top:8px;font-size:12.5px">
      专属链接：
      ${!s.link?.has_token ? '<span class="muted">尚未生成</span>'
        : s.link.active && s.active ? '<span class="link-on">● 生效中</span>' : '<span class="link-off">● 已停用</span>'}
      <span class="muted" style="margin-left:6px">更新于 ${fmtTime(s.link?.updated_at)}</span>
    </div>
    <div class="staff-actions">
      <button class="btn sm" onclick="showQR(${s.id})">${s.link?.has_token ? '🔳 查看二维码' : '🔳 生成专属链接'}</button>
      <button class="btn secondary sm" onclick="regen(${s.id},'${esc(s.name)}')">🔄 重新生成token</button>
      ${s.link?.has_token ? `<button class="btn ${s.link.active ? 'danger' : 'secondary'} sm" onclick="toggleToken(${s.id},${s.link.active ? 0 : 1})">${s.link.active ? '停用链接' : '启用链接'}</button>` : ''}
      <button class="btn ${s.active ? 'danger' : 'secondary'} sm" onclick="toggleActive(${s.id},${s.active ? 0 : 1},'${esc(s.name)}')">${s.active ? '停用账号' : '启用账号'}</button>
    </div>
  </div>`;
}
window.showQR = async id => {
  let s = allStaffCache.find(x => x.id === id);
  if (!s) s = (await api('/api/staff')).staff.find(x => x.id === id);
  if (!s?.link?.has_token) {
    if (confirm('该员工还没有专属链接，是否立即生成？')) return regen(id, s?.name || '');
    return;
  }
  try {
    const r = await api(`/api/staff/${id}/qr`);
    const abs = location.origin + r.url;
    openModal(`<h2>🔳 ${esc(s.name)} 的专属整改二维码</h2>
      <div class="qr-box">
        <img src="${r.qr}" alt="二维码">
        <div class="qr-url">${esc(abs)}</div>
        <div class="small">${r.active ? '<span class="link-on">链接生效中</span>' : '<span class="link-off">链接已停用，扫码无法进入</span>'}</div>
        <div class="small muted">保洁/维修人员微信或浏览器扫码即可进入本人整改任务页；链接仅限本人使用，泄露后可随时重新生成。</div>
      </div>
      <div class="modal-foot">
      </div>
      <div class="modal-foot">
        <button class="btn secondary" id="qrCopyBtn">复制链接</button>
        <button class="btn" onclick="closeModal()">关闭</button>
      </div>`);
    document.getElementById('qrCopyBtn').onclick = () => {
      navigator.clipboard?.writeText(abs);
      toast('链接已复制', 'ok');
    };
  } catch (err) { toast(err.message, 'err'); }
};
window.regen = async function (id, name) {
  if (!confirm(`重新生成后，${name} 之前的二维码/链接将立即失效，需要把新二维码重新发给本人。确认继续？`)) return;
  try {
    const r = await api(`/api/staff/${id}/regenerate-token`, { method: 'POST' });
    toast('已生成新 token，旧链接已失效', 'ok');
    openModal(`<h2>🔳 ${esc(name)} 的新专属二维码</h2>
      <div class="qr-box">
        <img src="${r.qr}" alt="二维码">
        <div class="qr-url">${esc(location.origin + r.url)}</div>
        <div class="small" style="color:#dc2626">⚠️ 旧链接已立即失效，请将此二维码重新发给本人张贴/保存。</div>
        <div class="small muted">token: <code>${esc(r.token)}</code></div>
      </div>
      <div class="modal-foot">
        <button class="btn secondary" onclick="navigator.clipboard?.writeText(location.origin+'${r.url}');toast('链接已复制','ok')">复制链接</button>
        <button class="btn" onclick="closeModal()">完成</button>
      </div>`);
    loadStaff();
  } catch (err) { toast(err.message, 'err'); }
};
window.toggleToken = async (id, active) => {
  if (!active && !confirm('停用后，该员工扫码将看到停用提示，无法提交整改照。确认停用？')) return;
  try {
    await api(`/api/staff/${id}/token-status`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !!active })
    });
    toast(active ? '链接已启用' : '链接已停用', 'ok'); loadStaff();
  } catch (err) { toast(err.message, 'err'); }
};
window.toggleActive = async (id, active, name) => {
  if (!active && !confirm(`停用账号「${name}」后其登录与扫码入口都将失效，确认？`)) return;
  try {
    await api(`/api/staff/${id}/active`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ active: !!active })
    });
    toast(active ? '账号已启用' : '账号已停用', 'ok'); loadStaff();
  } catch (err) { toast(err.message, 'err'); }
};
window.resetPwd = (id, name) => {
  openModal(`<h2>重置「${esc(name)}」的登录密码</h2>
    <div class="field"><label>新密码（至少 6 位）</label><input type="password" id="newPwd" placeholder="请输入新密码"></div>
    <div class="modal-foot">
      <button class="btn secondary" onclick="closeModal()">取消</button>
      <button class="btn" id="rpOk">确认重置</button>
    </div>`);
  document.getElementById('rpOk').onclick = async () => {
    try {
      await api(`/api/staff/${id}/reset-password`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('newPwd').value })
      });
      closeModal(); toast('密码已重置', 'ok');
    } catch (err) { toast(err.message, 'err'); }
  };
};
window.newStaff = function () {
  openModal(`<h2>➕ 新建员工</h2>
    <div class="form-row">
      <div class="field"><label>姓名 <span class="req">*</span></label><input id="nsName" placeholder="如：孙小梅"></div>
      <div class="field"><label>角色 <span class="req">*</span></label>
        <select id="nsRole"><option value="cleaner">🧹 保洁（二维码）</option>
        <option value="repairer">🔧 维修（二维码）</option>
        <option value="inspector">📋 巡查员（账号登录）</option>
        <option value="manager">🧑‍💼 经理（账号登录）</option></select></div>
    </div>
    <div class="field"><label>联系电话</label><input id="nsPhone" type="tel"></div>
    <div id="nsLoginFields">
      <div class="form-row">
        <div class="field"><label>登录账号</label><input id="nsUsername" placeholder="3-30 位字母数字"></div>
        <div class="field"><label>初始密码</label><input id="nsPassword" type="password" placeholder="至少 6 位"></div>
      </div>
    </div>
    <div class="small muted" id="nsHint">保洁 / 维修人员创建后，在卡片上点「生成专属链接」发放二维码。</div>
    <div class="modal-foot">
      <button class="btn secondary" onclick="closeModal()">取消</button>
      <button class="btn" id="nsOk">创建</button>
    </div>`);
  const roleSel = document.getElementById('nsRole');
  roleSel.onchange = () => {
    const login = ['manager', 'inspector'].includes(roleSel.value);
    document.getElementById('nsLoginFields').style.display = login ? '' : 'none';
  };
  roleSel.dispatchEvent(new Event('change'));
  document.getElementById('nsOk').onclick = async () => {
    try {
      const body = {
        name: document.getElementById('nsName').value.trim(),
        role: roleSel.value,
        phone: document.getElementById('nsPhone').value.trim(),
        username: document.getElementById('nsUsername').value.trim(),
        password: document.getElementById('nsPassword').value
      };
      await api('/api/staff', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      closeModal(); toast('员工已创建', 'ok'); loadStaff();
    } catch (err) { toast(err.message, 'err'); }
  };
};

/* ================= 日志 ================= */
let logPage = 1;
let logActionsLoaded = false;
async function loadLogs() {
  const params = new URLSearchParams({ page: logPage, page_size: 20 });
  const action = document.getElementById('logAction').value;
  const kw = document.getElementById('logKeyword').value.trim();
  if (action) params.set('action', action);
  if (kw) params.set('keyword', kw);
  const d = await api('/api/logs?' + params);
  if (!logActionsLoaded) {
    document.getElementById('logAction').innerHTML = '<option value="">全部动作</option>' +
      d.actions.map(a => `<option ${a === action ? 'selected' : ''}>${esc(a)}</option>`).join('');
    logActionsLoaded = true;
  }
  document.getElementById('logTable').innerHTML = `
    <tr><th>时间</th><th>操作人</th><th>动作</th><th>对象</th><th>详情</th><th>IP</th></tr>
    ${d.logs.map(l => `<tr>
      <td class="small">${esc(l.created_at)}</td>
      <td>${esc(l.actor_name)}</td>
      <td><span class="badge-chip neutral">${esc(l.action)}</span></td>
      <td>${esc(l.target)}</td>
      <td class="small">${esc(l.detail)}</td>
      <td class="small muted">${esc(l.ip)}</td>
    </tr>`).join('') || '<tr><td colspan="6" class="empty">暂无日志</td></tr>'}`;
  const pages = Math.max(1, Math.ceil(d.total / d.page_size));
  document.getElementById('logInfo').textContent = `共 ${d.total} 条，第 ${d.page}/${pages} 页`;
  document.getElementById('logPrev').disabled = d.page <= 1;
  document.getElementById('logNext').disabled = d.page >= pages;
}
document.getElementById('logSearchBtn').onclick = () => { logPage = 1; logActionsLoaded = false; loadLogs(); };
document.getElementById('logKeyword').addEventListener('keydown', e => { if (e.key === 'Enter') { logPage = 1; loadLogs(); } });
document.getElementById('logAction').addEventListener('change', () => { logPage = 1; loadLogs(); });
document.getElementById('logPrev').onclick = () => { if (logPage > 1) { logPage--; loadLogs(); } };
document.getElementById('logNext').onclick = () => { logPage++; loadLogs(); };
document.getElementById('logExport').onclick = e => {
  e.preventDefault();
  fetch('/api/logs/export', { headers: { Authorization: 'Bearer ' + store.token } })
    .then(r => r.blob()).then(blob => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = '巡查整改操作日志.csv'; a.click();
    });
};

// 初始加载
loadReview();
