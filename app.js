import { CapacitorSQLite, SQLiteConnection } from '@capacitor-community/sqlite';

const STORAGE_KEY = 'video_editor_invoice_db_v2';
let db = { customers: [] };
let sqliteConnection = null;

// ---------- Database Init ----------
async function initDatabase() {
  try {
    const sqlite = new SQLiteConnection(CapacitorSQLite);
    sqliteConnection = await sqlite.createConnection("db_invoice", false, "no-encryption", 1, false);
    await sqliteConnection.open();
    
    await sqliteConnection.execute(`
      CREATE TABLE IF NOT EXISTS app_data (id INTEGER PRIMARY KEY, json_text TEXT);
    `);
    
    const result = await sqliteConnection.query(`SELECT json_text FROM app_data WHERE id = 1;`);
    if (result.values.length > 0) {
      const parsed = JSON.parse(result.values[0].json_text);
      if (parsed && Array.isArray(parsed.customers)) db = parsed;
    } else {
      await sqliteConnection.run(`INSERT INTO app_data (id, json_text) VALUES (1, ?);`, [JSON.stringify(db)]);
    }
  } catch (error) {
    console.warn("SQLite not available (running in browser?). Using LocalStorage.");
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.customers)) db = parsed;
    }
  }
  render();
}

async function saveDB() {
  try {
    if (sqliteConnection) {
      await sqliteConnection.run(`UPDATE app_data SET json_text = ? WHERE id = 1;`, [JSON.stringify(db)]);
    }
  } catch (e) { console.error(e); }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(db)); // Fallback sync
}

// ---------- Utilities ----------
function uid(){ return 'id_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36); }
function formatMoney(n){ return Number(n||0).toLocaleString('en-US'); }
function todayJalali(){
  // یک تابع ساده برای تاریخ شمسی فعلی (برای پیش‌فرض ورودی)
  const date = new Date();
  // برای سادگی از همین میلادی استفاده میکنیم تا کتابخانه جلالی اضافه نشه، کاربر میتونه دستی ویرایش کنه
  return date.toISOString().slice(0,10);
}
function escapeHTML(str){
  const div = document.createElement('div');
  div.textContent = str ?? '';
  return div.innerHTML;
}
function formatInputMoney(e) {
  let val = e.value.replace(/\D/g, '');
  e.value = val ? Number(val).toLocaleString('en-US') : '';
}
function getNumberFromFormatted(str) {
  return Number((str || '').replace(/,/g, '')) || 0;
}

// ---------- Render ----------
function render(){
  renderStats();
  renderMonthFilter();
  renderCustomers();
}

function renderStats(){
  const monthFilter = document.getElementById('month-filter').value;
  let totalEarned = 0, totalPending = 0, projectCount = 0;
  const customerCount = db.customers.length;

  db.customers.forEach(c=>{
    c.projects.forEach(p=>{
      const pm = p.date ? p.date.slice(0,7) : '';
      if(monthFilter !== 'all' && pm !== monthFilter) return;
      projectCount++;
      const paid = Number(p.paidAmount||0);
      const total = Number(p.amount||0);
      totalEarned += paid;
      totalPending += (total - paid);
    });
  });

  const stats = [
    { label: 'تعداد مشتری', value: customerCount, accent:false },
    { label: 'تعداد پروژه', value: projectCount, accent:false },
    { label: 'درآمد دریافت‌شده', value: formatMoney(totalEarned), accent:true },
    { label: 'در انتظار دریافت', value: formatMoney(totalPending), accent:false },
  ];

  document.getElementById('stats').innerHTML = stats.map(s=>`
    <div class="stat-card">
      <div class="label">${s.label}</div>
      <div class="value ${s.accent?'accent':''}">${s.value}</div>
    </div>
  `).join('');
}

function renderMonthFilter(){
  const sel = document.getElementById('month-filter');
  const current = sel.value || 'all';
  const months = new Set();
  db.customers.forEach(c=> c.projects.forEach(p=>{ if(p.date) months.add(p.date.slice(0,7)); }));
  const sorted = Array.from(months).sort().reverse();
  let html = `<option value="all">همه ماه‌ها</option>`;
  sorted.forEach(m=>{ html += `<option value="${m}">${m}</option>`; });
  sel.innerHTML = html;
  sel.value = sorted.includes(current) || current==='all' ? current : 'all';
}

function renderCustomers(){
  const list = document.getElementById('customer-list');
  const monthFilter = document.getElementById('month-filter').value;
  const statusFilter = document.getElementById('status-filter').value;
  const searchTerm = document.getElementById('search-input').value.toLowerCase().trim();

  if(db.customers.length === 0){
    list.innerHTML = `<div class="empty"><div class="big">🗂️</div>هنوز مشتری‌ای ثبت نشده.</div>`;
    return;
  }

  list.innerHTML = db.customers.map(c=>{
    let filteredProjects = c.projects.filter(p=>{
      const pm = p.date ? p.date.slice(0,7) : '';
      if(monthFilter !== 'all' && pm !== monthFilter) return false;
      
      const paid = Number(p.paidAmount||0);
      const total = Number(p.amount||0);
      const isPaid = paid >= total && total > 0;
      
      if(statusFilter === 'pending' && isPaid) return false;
      if(statusFilter === 'paid' && !isPaid) return false;
      
      if(searchTerm && !c.name.toLowerCase().includes(searchTerm) && !p.title.toLowerCase().includes(searchTerm)) return false;
      return true;
    });

    // محاسبه بر اساس فیلترها
    const totalDue = filteredProjects.reduce((s,p)=> s + (Number(p.amount||0) - Number(p.paidAmount||0)), 0);
    const totalAll = filteredProjects.reduce((s,p)=> s + Number(p.amount||0), 0);

    const projectsHTML = filteredProjects.length === 0
      ? `<div class="project-row"><div class="project-info"><div class="title" style="color:var(--text-dim)">پروژه‌ای یافت نشد</div></div></div>`
      : filteredProjects.map(p=>{
          const paid = Number(p.paidAmount||0);
          const total = Number(p.amount||0);
          const isPaid = paid >= total && total > 0;
          const isPartial = paid > 0 && paid < total;
          
          let statusBadge = '';
          if(isPaid) statusBadge = `<span class="status-badge done">تسویه کامل</span>`;
          else if(isPartial) statusBadge = `<span class="status-badge partial">پرداخت جزئی</span>`;

          return `
        <div class="project-row ${isPaid?'paid':''}">
          <div class="project-info">
            <div class="title">${escapeHTML(p.title)} ${statusBadge}</div>
            <div class="date">${p.date || '—'} | ${isPartial ? `پرداخت شده: ${formatMoney(paid)}` : ''}</div>
          </div>
          <div class="project-amount">${formatMoney(p.amount)} تومان</div>
          <div class="project-actions">
            <span class="toggle-pill ${p.delivered?'active delivered':''}" onclick="toggleProjectField('${c.id}','${p.id}','delivered')">${p.delivered?'✓ انجام شد':'در انتظار انجام'}</span>
            <button class="btn btn-small btn-ghost" onclick="event.stopPropagation(); openProjectModal('${c.id}','${p.id}')">✎ ویرایش</button>
            <button class="btn btn-small btn-danger" onclick="deleteProject('${c.id}','${p.id}')">حذف</button>
          </div>
        </div>
      `}).join('');

    return `
      <div class="customer-block" id="cust-${c.id}">
        <div class="customer-header" onclick="toggleCollapse('${c.id}')">
          <div>
            <div class="name">${escapeHTML(c.name)}</div>
            <div class="meta">${c.projects.length} پروژه · مجموع: ${formatMoney(totalAll)} تومان${c.note ? ' · ' + escapeHTML(c.note) : ''}</div>
          </div>
          <div class="right">
            <div class="totals">
              <div class="due-label">مانده طلب</div>
              <div class="due">${formatMoney(totalDue)} تومان</div>
            </div>
            <button class="btn btn-small btn-ghost" onclick="event.stopPropagation(); openProjectModal('${c.id}')">+ پروژه</button>
            <button class="btn btn-small btn-primary" onclick="event.stopPropagation(); exportInvoice('${c.id}')">فاکتور</button>
            <button class="btn btn-small btn-danger" onclick="event.stopPropagation(); deleteCustomer('${c.id}')">حذف</button>
            <svg class="chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 9l6 6 6-6"/></svg>
          </div>
        </div>
        <div class="projects">${projectsHTML}</div>
      </div>
    `;
  }).join('');
}

// ---------- Interactions ----------
window.toggleCollapse = (custId)=>{
  document.getElementById('cust-' + custId).classList.toggle('collapsed');
}

window.toggleProjectField = async (custId, projId, field)=>{
  const cust = db.customers.find(c=>c.id===custId);
  const proj = cust.projects.find(p=>p.id===projId);
  proj[field] = !proj[field];
  await saveDB();
  render();
}

window.deleteProject = async (custId, projId)=>{
  if(!confirm('این پروژه حذف شود؟')) return;
  const cust = db.customers.find(c=>c.id===custId);
  cust.projects = cust.projects.filter(p=>p.id!==projId);
  await saveDB();
  render();
}

window.deleteCustomer = async (custId)=>{
  if(!confirm('این مشتری و همه پروژه‌هایش حذف شوند؟')) return;
  db.customers = db.customers.filter(c=>c.id!==custId);
  await saveDB();
  render();
}

window.openModal = (id) => document.getElementById(id).classList.add('active');
window.closeModal = (id) => document.getElementById(id).classList.remove('active');

// Close modal on backdrop click or ESC
document.querySelectorAll('.modal-backdrop').forEach(modal => {
  modal.addEventListener('click', (e) => { if(e.target === modal) modal.classList.remove('active'); });
});
document.addEventListener('keydown', (e) => {
  if(e.key === 'Escape') document.querySelectorAll('.modal-backdrop.active').forEach(m => m.classList.remove('active'));
});

// Customer Modal Logic
document.getElementById('btn-new-customer').onclick = ()=>{
  document.getElementById('cust-edit-id').value = '';
  document.getElementById('customer-modal-title').innerText = 'افزودن مشتری جدید';
  document.getElementById('cust-name').value='';
  document.getElementById('cust-note').value='';
  openModal('modal-customer');
};

window.editCustomer = (custId) => {
  const c = db.customers.find(c=>c.id===custId);
  document.getElementById('cust-edit-id').value = c.id;
  document.getElementById('customer-modal-title').innerText = 'ویرایش مشتری';
  document.getElementById('cust-name').value = c.name;
  document.getElementById('cust-note').value = c.note || '';
  openModal('modal-customer');
};

document.getElementById('save-customer').onclick = async ()=>{
  const name = document.getElementById('cust-name').value.trim();
  if(!name){ alert('نام مشتری را وارد کن'); return; }
  const editId = document.getElementById('cust-edit-id').value;
  
  if(editId){
    const cust = db.customers.find(c=>c.id===editId);
    cust.name = name;
    cust.note = document.getElementById('cust-note').value.trim();
  } else {
    db.customers.push({ id: uid(), name, note: document.getElementById('cust-note').value.trim(), projects: [] });
  }
  await saveDB();
  closeModal('modal-customer');
  render();
};

// Project Modal Logic
window.openProjectModal = (custId, projId=null)=>{
  const c = db.customers.find(c=>c.id===custId);
  document.getElementById('proj-customer-id').value = custId;
  document.getElementById('proj-edit-id').value = '';
  
  if(projId){
    const p = c.projects.find(p=>p.id===projId);
    document.getElementById('project-modal-title').innerText = 'ویرایش پروژه';
    document.getElementById('proj-edit-id').value = projId;
    document.getElementById('proj-title').value = p.title;
    document.getElementById('proj-amount').value = formatMoney(p.amount);
    document.getElementById('proj-paid-amount').value = formatMoney(p.paidAmount || 0);
    document.getElementById('proj-date').value = p.date || '';
  } else {
    document.getElementById('project-modal-title').innerText = 'افزودن پروژه جدید';
    document.getElementById('proj-title').value='';
    document.getElementById('proj-amount').value='';
    document.getElementById('proj-paid-amount').value='';
    document.getElementById('proj-date').value = todayJalali();
  }
  openModal('modal-project');
};

document.getElementById('save-project').onclick = async ()=>{
  const custId = document.getElementById('proj-customer-id').value;
  const editId = document.getElementById('proj-edit-id').value;
  const title = document.getElementById('proj-title').value.trim();
  const amount = getNumberFromFormatted(document.getElementById('proj-amount').value);
  const paidAmount = getNumberFromFormatted(document.getElementById('proj-paid-amount').value);
  const date = document.getElementById('proj-date').value;
  
  if(!title || !amount){ alert('عنوان و مبلغ کل را وارد کن'); return; }
  
  const cust = db.customers.find(c=>c.id===custId);
  if(editId){
    const p = cust.projects.find(p=>p.id===editId);
    p.title = title; p.amount = amount; p.paidAmount = paidAmount; p.date = date;
  } else {
    cust.projects.push({ id: uid(), title, amount, paidAmount, date, delivered:false });
  }
  await saveDB();
  closeModal('modal-project');
  render();
};

// Filters
document.getElementById('month-filter').onchange = render;
document.getElementById('status-filter').onchange = render;
document.getElementById('search-input').oninput = render;

// ---------- Invoice export ----------
window.exportInvoice = async (custId)=>{
  const cust = db.customers.find(c=>c.id===custId);
  const pendingProjects = cust.projects.filter(p => (Number(p.paidAmount||0)) < (Number(p.amount||0)));
  const projectsToShow = pendingProjects.length > 0 ? pendingProjects : cust.projects;
  
  // محاسبه بدهکار باقیمانده
  const total = projectsToShow.reduce((s,p)=> s + (Number(p.amount||0) - Number(p.paidAmount||0)), 0);

  const rowsHTML = projectsToShow.map(p=>`
    <tr>
      <td>${escapeHTML(p.title)}</td>
      <td>${p.date || '—'}</td>
      <td class="amt">${formatMoney(Number(p.amount) - Number(p.paidAmount||0))} تومان</td>
    </tr>
  `).join('');

  const now = new Date();
  const dateStr = now.toLocaleDateString('fa-IR');

  const html = `
    <div class="inv-head">
      <div><h1>فاکتور پروژه‌های ادیت</h1></div>
      <div class="inv-meta"><div>تاریخ صدور: ${dateStr}</div></div>
    </div>
    <div class="inv-customer">
      <div class="label">صادر شده برای</div>
      <div class="name">${escapeHTML(cust.name)}</div>
    </div>
    <table class="inv-table">
      <thead><tr><th>عنوان پروژه</th><th>تاریخ</th><th class="amt">مبلغ باقیمانده</th></tr></thead>
      <tbody>${rowsHTML}</tbody>
    </table>
    <div class="inv-total">
      <div class="box">
        <div class="lbl">${pendingProjects.length>0 ? 'مجموع قابل پرداخت' : 'مجموع کل'}</div>
        <div class="amt">${formatMoney(total)} تومان</div>
      </div>
    </div>
    <div class="inv-footer">این فاکتور به صورت خودکار از دفتر حساب پروژه‌ها تولید شده است.</div>
  `;

  const renderEl = document.getElementById('invoice-render');
  renderEl.innerHTML = html;

  try {
    const dataUrl = await htmlToImage.toJpeg(renderEl, { quality: 0.95, backgroundColor: '#0c1220' });
    const link = document.createElement('a');
    link.download = `invoice-${cust.name.replace(/[^a-zA-Z0-9آ-ی]/g,'_')}-${todayJalali()}.jpg`;
    link.href = dataUrl;
    link.click();
  } catch (error) {
    console.error("Image export failed", error);
    alert("خطا در ساخت تصویر فاکتور");
  }
}

// ---------- Init ----------
document.addEventListener('DOMContentLoaded', initDatabase);
