requireRole('inspector');
let picked = [];

document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  t.classList.add('active');
  document.getElementById('tab-new').hidden = t.dataset.tab !== 'new';
  document.getElementById('tab-list').hidden = t.dataset.tab !== 'list';
  if (t.dataset.tab === 'list') loadIssues();
}));

// ---------- 加载整改人员 ----------
api('/api/staff').then(({ staff }) => {
  const sel = document.querySelector('[name=assignee_id]');
  sel.innerHTML = '<option value="">请选择整改人…</option>' + staff.map(s =>
    `<option value="${s.id}">${s.role === 'cleaner' ? '🧹 保洁' : '🔧 维修'} · ${esc(s.name)}</option>`).join('');
});

// ---------- 图片选择 ----------
const input = document.getElementById('photoInput');
const uploader = document.getElementById('uploader');
uploader.addEventListener('click', () => input.click());
['dragover', 'dragenter'].forEach(ev => uploader.addEventListener(ev, e => { e.preventDefault(); uploader.classList.add('drag'); }));
['dragleave', 'drop'].forEach(ev => uploader.addEventListener(ev, e => { e.preventDefault(); uploader.classList.remove('drag'); }));
uploader.addEventListener('drop', e => addFiles(e.dataTransfer.files));
input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });

function addFiles(fileList) {
  for (const f of fileList) {
    if (!f.type.startsWith('image/')) { toast('仅支持图片文件', 'err'); continue; }
    if (f.size > 10 * 1024 * 1024) { toast(`「${f.name}」超过 10MB`, 'err'); continue; }
    if (picked.length >= 6) { toast('最多 6 张照片', 'err'); break; }
    picked.push(f);
  }
  renderPreview();
}
function renderPreview() {
  const box = document.getElementById('preview');
  box.innerHTML = picked.map((f, i) =>
    `<div class="item"><img src="${URL.createObjectURL(f)}" alt=""><button type="button" class="rm" data-i="${i}">✕</button></div>`).join('');
  box.querySelectorAll('.rm').forEach(b => b.addEventListener('click', () => { picked.splice(+b.dataset.i, 1); renderPreview(); }));
  document.getElementById('photoCount').textContent = picked.length ? `已选 ${picked.length} 张` : '尚未选择';
}

// ---------- 提交 ----------
document.getElementById('issueForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (!picked.length) return toast('请至少上传 1 张问题照片', 'err');
  const fd = new FormData(e.target);
  picked.forEach(f => fd.append('photos', f));
  const btn = document.getElementById('submitBtn');
  btn.disabled = true; btn.textContent = '提交中…';
  try {
    await api('/api/issues', { method: 'POST', body: fd });
    toast('问题单已提交，已通知整改人', 'ok');
    picked = []; renderPreview(); e.target.reset();
    document.querySelector('[name=points]').value = 2;
    document.querySelector('[name=due_hours]').value = 48;
  } catch (err) { toast(err.message, 'err'); }
  btn.disabled = false; btn.textContent = '✅ 提交问题单';
});

// ---------- 我的单子 ----------
async function loadIssues() {
  const box = document.getElementById('issueList');
  box.innerHTML = '<div class="empty">加载中…</div>';
  const params = new URLSearchParams();
  const st = document.getElementById('fStatus').value;
  const loc = document.getElementById('fLoc').value;
  if (st) params.set('status', st);
  if (loc) params.set('location_type', loc);
  const { issues } = await api('/api/issues?' + params);
  if (!issues.length) { box.innerHTML = '<div class="empty"><div class="big">🗂️</div>暂无巡查单</div>'; return; }
  box.innerHTML = issues.map(issueCard).join('');
}
function issueCard(i) {
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
        <span>🕒 上报：${fmtTime(i.created_at)}</span>
        <span>⏳ 限期：${fmtTime(i.due_at)}</span>
      </div>
      <div class="pair-label before">问题照片 ${i.before_count} 张${i.after_count ? ` · 整改照 ${i.after_count} 张` : ''}</div>
      <button class="btn secondary sm" onclick="viewIssue(${i.id})">查看详情 / 整改对比</button>
      ${i.status === 'rejected' ? `<div class="reject-box">经理驳回：${esc(i.review_note || '请重新整改')}</div>` : ''}
    </div>
  </div>`;
}
window.viewIssue = async function (id) {
  const { issue: i } = await api('/api/issues/' + id);
  openModal(`
    <h2>${esc(i.code)} ${locTag(i.location_type)} ${statusPill(i.status)}</h2>
    <dl class="kv">
      <dt>位置</dt><dd>${esc(i.location_detail)}</dd>
      <dt>描述</dt><dd>${esc(i.description || '—')}</dd>
      <dt>整改人</dt><dd>${esc(i.assignee_name)}（${i.assignee_role === 'cleaner' ? '保洁' : '维修'}）</dd>
      <dt>扣分</dt><dd class="points-tag">${i.points} 分</dd>
      <dt>限期</dt><dd>${fmtTime(i.due_at)}</dd>
      <dt>整改说明</dt><dd>${esc(i.submitted_note || '—')}</dd>
      <dt>审核备注</dt><dd>${esc(i.review_note || '—')}</dd>
    </dl>
    <div class="pair-label before">整改前</div>${thumbsHtml(i.before, 'before')}
    ${i.after.length ? `<div class="pair-label after">整改后（拖动滑块对比）</div>${compareBlock(photoUrl(i.before[0]), photoUrl(i.after[0]))}`
      : '<div class="muted small">整改人尚未提交整改照片</div>'}
    <div class="modal-foot"><button class="btn secondary" onclick="closeModal()">关闭</button></div>`);
};
document.getElementById('fStatus').addEventListener('change', loadIssues);
document.getElementById('fLoc').addEventListener('change', loadIssues);

// ---------- 统计 ----------
api('/api/issues').then(({ issues }) => {
  const c = k => issues.filter(x => x.status === k).length;
  document.getElementById('myStats').innerHTML = `
    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <span>📋 共 ${issues.length} 单</span>
      <span style="color:#92400e">待整改 ${c('pending')}</span>
      <span style="color:#1e40af">待审核 ${c('submitted')}</span>
      <span style="color:#166534">已通过 ${c('approved')}</span>
      <span style="color:#991b1b">已驳回 ${c('rejected')}</span>
    </div>`;
});
