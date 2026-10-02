const app = document.getElementById('app');

function disabledScreen(data, invalid) {
  app.innerHTML = `<div class="disabled-screen">
    <div class="big">${invalid ? '🔗' : '⛔'}</div>
    <h2>${invalid ? '链接无效' : '整改入口已停用'}</h2>
    <p class="muted">${esc(data?.error || '该专属链接无法使用，请联系经理重新获取二维码。')}</p>
    ${data?.staff ? `<p class="small">员工：${esc(data.staff.name)}（${data.staff.role === 'cleaner' ? '保洁' : '维修'}）</p>` : ''}
    <p class="small muted">物业公区巡查整改系统</p>
  </div>`;
}

async function boot() {
  if (!workerToken) return disabledScreen({ error: '缺少专属 token，请重新扫描二维码' }, true);
  try {
    await render();
  } catch (err) {
    if (err.status === 403 && (err.code === 'TOKEN_DISABLED' || err.code === 'STAFF_DISABLED')) return disabledScreen(err.data);
    if (err.status === 401) return disabledScreen(err.data || { error: '链接无效或已被重新生成，请扫描最新二维码' }, true);
    app.innerHTML = `<div class="disabled-screen"><div class="big">⚠️</div><p>${esc(err.message)}</p>
      <button class="btn" onclick="boot()">重试</button></div>`;
  }
}

async function render() {
  const [{ worker, stats }, { issues }] = await Promise.all([api('/api/w/me'), api('/api/w/issues')]);
  app.innerHTML = `<div class="mobile-shell">
    <div class="worker-hero">
      <div style="display:flex;align-items:center;gap:12px">
        <div class="avatar" style="background:rgba(255,255,255,.2);color:#fff">${esc(worker.name[0])}</div>
        <div>
          <div class="name">${esc(worker.name)}</div>
          <div class="role">${worker.role === 'cleaner' ? '🧹 保洁人员' : '🔧 维修人员'} · 整改工作台</div>
        </div>
      </div>
      <div class="worker-stat">
        <div class="ws"><b>${stats.pending}</b><span>待整改${stats.overdue ? `（${stats.overdue}超时）` : ''}</span></div>
        <div class="ws"><b>${stats.submitted}</b><span>待审核</span></div>
        <div class="ws"><b>${stats.approved}</b><span>已通过</span></div>
        <div class="ws"><b style="color:#fde68a">${stats.points}</b><span>累计扣分</span></div>
      </div>
    </div>

    <div class="section-title">🧰 我的整改任务（${issues.length}）</div>
    <div id="taskList" class="issue-list"></div>
  </div>`;
  const box = document.getElementById('taskList');
  if (!issues.length) {
    box.innerHTML = '<div class="empty"><div class="big">🎉</div>暂无待处理任务</div>';
    return;
  }
  box.innerHTML = issues.map(taskCard).join('');
}

function taskCard(i) {
  const overdue = i.status === 'pending' && i.due_at && i.due_at < nowSql();
  return `<div class="issue-card">
    <div class="issue-head">
      ${locTag(i.location_type)}${statusPill(i.status)}
      ${overdue ? '<span class="overdue-tag">⏰ 已超过整改时限</span>' : ''}
      <span class="spacer"></span><span class="points-tag">扣 ${i.points} 分</span>
    </div>
    <div class="issue-body">
      <div style="font-weight:600">${esc(i.location_detail)}</div>
      ${i.description ? `<div class="issue-desc">${esc(i.description)}</div>` : ''}
      <div class="issue-meta">
        <span>📋 ${esc(i.code)}</span><span>🕐 限期 ${fmtTime(i.due_at)}</span>
        <span>巡查：${esc(i.inspector_name)}</span>
      </div>
      ${i.status === 'rejected' ? `<div class="reject-box">❌ 审核驳回：${esc(i.review_note || '请按要求重新整改')}${i.after_count ? '（此前整改照已退回）' : ''}</div>` : ''}
      ${i.status === 'submitted' ? `<div class="note-box">✅ 整改照已提交，等待经理审核，无需重复操作。${i.submitted_note ? '<br>说明：' + esc(i.submitted_note) : ''}</div>` : ''}
      <div class="issue-foot">
        <button class="btn sm" onclick="openTask(${i.id})">📄 查看问题照片</button>
        ${i.status === 'pending' || i.status === 'rejected'
          ? `<button class="btn sm" style="margin-left:auto" onclick="openSubmit(${i.id})">📷 ${i.status === 'rejected' ? '重新提交整改' : '上传整改照'}</button>` : ''}
      </div>
    </div>
  </div>`;
}

window.openTask = async id => {
  const { issue: i } = await api('/api/w/issues/' + id);
  openModal(`<h2>${esc(i.location_detail)} ${statusPill(i.status)}</h2>
    <dl class="kv">
      <dt>单号</dt><dd>${esc(i.code)}</dd><dt>点位</dt><dd>${i.location_label}</dd>
      <dt>扣分</dt><dd class="points-tag">${i.points} 分</dd><dt>限期</dt><dd>${fmtTime(i.due_at)}</dd>
    </dl>
    <div class="pair-label before">巡查员上报的问题照片</div>${thumbsHtml(i.before, 'before')}
    ${i.after.length ? `<div class="pair-label after">我提交的整改照</div>${thumbsHtml(i.after, 'after')}` : ''}
    <div class="modal-foot"><button class="btn secondary" onclick="closeModal()">关闭</button></div>`);
};

// ---------- 提交整改 ----------
let submitPicked = [];
window.openSubmit = async id => {
  submitPicked = [];
  const { issue: i } = await api('/api/w/issues/' + id);
  openModal(`<h2>📷 上传整改完成照</h2>
    <div class="small muted">${esc(i.code)} · ${esc(i.location_detail)} · 扣 ${i.points} 分</div>
    <div class="pair-label before">整改前（巡查员拍摄）</div>
    ${thumbsHtml(i.before, 'before')}
    <div class="divider"></div>
    <div class="field">
      <label>整改完成照片（1–6 张）<span class="req">*</span></label>
      <input type="file" id="wPhotoInput" accept="image/*" multiple hidden>
      <div class="uploader" id="wUploader">
        <div class="big">📷</div><div>点击拍照 / 选择整改后的照片</div>
        <div class="small muted" id="wPhotoCount">尚未选择</div>
      </div>
      <div class="upload-preview" id="wPreview"></div>
    </div>
    <div class="field">
      <label>整改说明</label>
      <textarea id="wNote" maxlength="300" placeholder="如：垃圾已清运、地面已冲洗…">${esc(i.submitted_note || '')}</textarea>
    </div>
    <div class="modal-foot">
      <button class="btn secondary" onclick="closeModal()">取消</button>
      <button class="btn" id="wSubmitBtn">✅ 提交给经理审核</button>
    </div>`);
  const fileInput = document.getElementById('wPhotoInput');
  const up = document.getElementById('wUploader');
  up.addEventListener('click', () => fileInput.click());
  ['dragover', 'dragenter'].forEach(ev => up.addEventListener(ev, e => { e.preventDefault(); up.classList.add('drag'); }));
  ['dragleave', 'drop'].forEach(ev => up.addEventListener(ev, e => { e.preventDefault(); up.classList.remove('drag'); }));
  up.addEventListener('drop', e => addSubmitFiles(e.dataTransfer.files));
  fileInput.addEventListener('change', () => { addSubmitFiles(fileInput.files); fileInput.value = ''; });
  document.getElementById('wSubmitBtn').addEventListener('click', () => doSubmit(id));
};
function addSubmitFiles(fileList) {
  for (const f of fileList) {
    if (!f.type.startsWith('image/')) { toast('仅支持图片', 'err'); continue; }
    if (f.size > 10 * 1024 * 1024) { toast('单张不能超过 10MB', 'err'); continue; }
    if (submitPicked.length >= 6) { toast('最多 6 张', 'err'); break; }
    submitPicked.push(f);
  }
  renderSubmitPreview();
}
function renderSubmitPreview() {
  const box = document.getElementById('wPreview');
  box.innerHTML = submitPicked.map((f, k) =>
    `<div class="item"><img src="${URL.createObjectURL(f)}"><button type="button" class="rm" data-k="${k}">✕</button></div>`).join('');
  box.querySelectorAll('.rm').forEach(b => b.onclick = () => { submitPicked.splice(+b.dataset.k, 1); renderSubmitPreview(); });
  document.getElementById('wPhotoCount').textContent = submitPicked.length ? `已选 ${submitPicked.length} 张` : '尚未选择';
}
async function doSubmit(id) {
  if (!submitPicked.length) return toast('请至少拍摄 / 选择 1 张整改照', 'err');
  const fd = new FormData();
  fd.append('note', document.getElementById('wNote').value.trim());
  submitPicked.forEach(f => fd.append('photos', f));
  const btn = document.getElementById('wSubmitBtn');
  btn.disabled = true; btn.textContent = '提交中…';
  try {
    await api(`/api/w/issues/${id}/submit`, { method: 'POST', body: fd });
    closeModal();
    toast('整改照已提交，等待经理审核 ✅', 'ok', 3200);
    render();
  } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = '✅ 提交给经理审核'; }
}

boot();
