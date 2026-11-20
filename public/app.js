const $app = document.getElementById('app');
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const fmtDate = (iso) => {
  const [y, m, d] = iso.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
};

const S = { token: null, role: null, name: null, view: 'home', workId: null, childId: null, variant: 1 };
try { Object.assign(S, JSON.parse(localStorage.getItem('hw') || '{}')); } catch {}

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('on'), 2800);
}

function save() {
  localStorage.setItem('hw', JSON.stringify({
    token: S.token, role: S.role, name: S.name, childId: S.childId,
  }));
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  const res = await fetch('/api' + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    S.token = null; S.role = null; S.name = null; save();
    render();
    throw new Error(data.error || 'Нужно войти');
  }
  if (!res.ok) throw new Error(data.error || 'Ошибка');
  return data;
}

function topbar(title, back) {
  return `<header class="top">
    ${back ? `<button type="button" class="sec ico" id="back">←</button>` : ''}
    <h1>${esc(title)}</h1>
    <button type="button" class="sec" id="logout">Выйти</button>
  </header>`;
}

function bindChrome(backFn) {
  document.getElementById('logout').onclick = () => {
    S.token = null; S.role = null; S.name = null; S.workId = null; save();
    render();
  };
  const b = document.getElementById('back');
  if (b && backFn) b.onclick = backFn;
}

// ---------- Login ----------
function renderLogin() {
  let role = 'teacher';
  $app.innerHTML = `<div class="wrap login">
    <h1>Проверка работ</h1>
    <div class="seg" id="roles">
      <button type="button" data-r="teacher" class="on">Учитель</button>
      <button type="button" data-r="student">Ученик</button>
    </div>
    <label class="lbl" id="nameLbl">ФИО</label>
    <input id="name" autocomplete="name" placeholder="Иванова И.И.">
    <label class="lbl">Код</label>
    <input id="secret" type="password" autocomplete="current-password" placeholder="Код доступа">
    <button type="button" id="go" style="width:100%">Войти</button>
    <div id="err" class="err" hidden></div>
  </div>`;

  const nameEl = document.getElementById('name');
  const secretEl = document.getElementById('secret');
  const err = document.getElementById('err');
  const nameLbl = document.getElementById('nameLbl');

  document.getElementById('roles').onclick = (e) => {
    const btn = e.target.closest('button[data-r]');
    if (!btn) return;
    role = btn.dataset.r;
    document.querySelectorAll('#roles button').forEach((b) => b.classList.toggle('on', b.dataset.r === role));
    const teacher = role === 'teacher';
    nameLbl.hidden = !teacher;
    nameEl.hidden = !teacher;
  };

  document.getElementById('go').onclick = async () => {
    err.hidden = true;
    try {
      const body = { role, secret: secretEl.value };
      if (role === 'teacher') body.name = nameEl.value;
      const data = await api('/login', { method: 'POST', body: JSON.stringify(body) });
      S.token = data.token; S.role = data.role; S.name = data.name; S.view = 'home';
      save();
      render();
    } catch (e) {
      err.textContent = e.message;
      err.hidden = false;
    }
  };
}

// ---------- Teacher home ----------
async function renderTeacherHome() {
  $app.innerHTML = `<div class="wrap">${topbar('Работы')}<p class="mu">${esc(S.name)}</p>
    <div class="card" id="newWork">
      <label class="lbl">Новая работа</label>
      <input id="title" placeholder="Название">
      <div class="row" style="margin-top:8px">
        <div><label class="lbl">Дата</label><input id="date" type="date" value="${todayStr()}"></div>
        <div><label class="lbl">Заданий</label><input id="tasks" type="number" min="1" max="50" value="19"></div>
        <div><label class="lbl">Вариантов</label><input id="vars" type="number" min="1" max="10" value="2"></div>
      </div>
      <button type="button" id="create" style="width:100%;margin-top:10px">Создать</button>
    </div>
    <div class="card">
      <label class="lbl">Дети (фамилии)</label>
      <div class="row">
        <input id="childName" placeholder="Фамилия">
        <button type="button" id="addChild">Добавить</button>
      </div>
      <div class="chip-row" id="children" style="margin-top:10px"></div>
    </div>
    <div id="list"></div>
  </div>`;
  bindChrome();

  const [works, children] = await Promise.all([api('/works'), api('/children')]);
  const chBox = document.getElementById('children');
  chBox.innerHTML = children.length
    ? children.map((c) => `<span class="chip">${esc(c.name)}
        <button type="button" data-del="${c.id}" aria-label="Удалить">×</button></span>`).join('')
    : '<span class="mu">Пока никого</span>';
  chBox.onclick = async (e) => {
    const id = e.target.dataset?.del;
    if (!id) return;
    if (!confirm('Удалить ребёнка и все его сдачи?')) return;
    await api('/children/' + id, { method: 'DELETE' });
    toast('Удалено');
    renderTeacherHome();
  };

  document.getElementById('addChild').onclick = async () => {
    const name = document.getElementById('childName').value;
    try {
      await api('/children', { method: 'POST', body: JSON.stringify({ name }) });
      toast('Добавлен');
      renderTeacherHome();
    } catch (e) { toast(e.message); }
  };

  document.getElementById('create').onclick = async () => {
    try {
      const body = {
        title: document.getElementById('title').value,
        date: document.getElementById('date').value,
        task_count: Number(document.getElementById('tasks').value),
        variant_count: Number(document.getElementById('vars').value),
      };
      const r = await api('/works', { method: 'POST', body: JSON.stringify(body) });
      S.workId = r.id; S.view = 'key';
      render();
    } catch (e) { toast(e.message); }
  };

  const list = document.getElementById('list');
  if (!works.length) {
    list.innerHTML = '<div class="empty">Работ пока нет</div>';
    return;
  }
  list.innerHTML = works.map((w) => `
    <button type="button" class="list-item" data-id="${w.id}">
      <div style="flex:1;text-align:left">
        <b>${esc(w.title)}</b>
        <small>${fmtDate(w.date)} · заданий ${w.task_count} · вар. ${w.variant_count}
          · сдач ${w.submissions} · ключ ${w.keyed_variants}/${w.variant_count}</small>
      </div>
    </button>`).join('');
  list.onclick = (e) => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    S.workId = Number(btn.dataset.id);
    S.view = 'work';
    render();
  };
}

// ---------- Teacher work ----------
async function renderTeacherWork() {
  const data = await api('/works/' + S.workId);
  const w = data.work;
  $app.innerHTML = `<div class="wrap">${topbar(w.title, true)}
    <p class="mu">${fmtDate(w.date)} · ${w.task_count} заданий · ${w.variant_count} вар.</p>
    <div class="stack">
      <button type="button" id="toKey">Заполнить ключ</button>
      <button type="button" id="toMatrix" class="sec">Таблица сравнения</button>
      <button type="button" id="delWork" class="danger">Удалить работу</button>
    </div>
  </div>`;
  bindChrome(() => { S.view = 'home'; render(); });
  document.getElementById('toKey').onclick = () => { S.view = 'key'; render(); };
  document.getElementById('toMatrix').onclick = () => { S.view = 'matrix'; render(); };
  document.getElementById('delWork').onclick = async () => {
    if (!confirm('Удалить работу и все ответы?')) return;
    await api('/works/' + S.workId, { method: 'DELETE' });
    S.workId = null; S.view = 'home';
    toast('Удалено');
    render();
  };
}

async function renderKey() {
  const data = await api('/works/' + S.workId);
  const w = data.work;
  let variant = S.variant || 1;
  if (variant > w.variant_count) variant = 1;

  function paint() {
    const keys = (data.keys && data.keys[variant]) || {};
    $app.innerHTML = `<div class="wrap">${topbar('Ключ: ' + w.title, true)}
      <div class="tabs" id="tabs">
        ${Array.from({ length: w.variant_count }, (_, i) => i + 1).map((v) =>
          `<button type="button" data-v="${v}" class="${v === variant ? 'on' : ''}">Вариант ${v}</button>`
        ).join('')}
      </div>
      <div class="tasks" id="tasks">
        ${Array.from({ length: w.task_count }, (_, i) => i + 1).map((n) => `
          <div class="task">
            <div class="num">${n}</div>
            <input data-n="${n}" value="${esc(keys[n] || '')}" placeholder="Ответ">
          </div>`).join('')}
      </div>
      <button type="button" id="save" style="width:100%;margin-top:14px">Сохранить вариант ${variant}</button>
    </div>`;
    bindChrome(() => { S.view = 'work'; render(); });
    document.getElementById('tabs').onclick = (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      variant = Number(b.dataset.v);
      S.variant = variant;
      paint();
    };
    document.getElementById('save').onclick = async () => {
      const answers = {};
      document.querySelectorAll('#tasks input').forEach((inp) => {
        answers[inp.dataset.n] = inp.value;
      });
      try {
        await api('/works/' + S.workId + '/keys', {
          method: 'PUT',
          body: JSON.stringify({ variant, answers }),
        });
        if (!data.keys) data.keys = {};
        data.keys[variant] = answers;
        toast('Сохранено');
      } catch (e) { toast(e.message); }
    };
  }
  paint();
}

async function renderMatrix() {
  const data = await api('/works/' + S.workId + '/matrix');
  const w = data.work;
  const cols = data.columns;
  const statusLabel = { match: '✓', mismatch: '✗', missing: '—', no_key: '?' };

  let body = '';
  for (let n = 1; n <= w.task_count; n++) {
    body += `<tr><td class="sticky">${n}</td>`;
    for (const col of cols) {
      if (!col.cells) {
        body += `<td class="missing" title="Не сдавал">—</td>`;
      } else {
        const cell = col.cells[n - 1];
        const tip = cell.student != null
          ? `ответ: ${cell.student}` + (cell.key != null ? ` | ключ: ${cell.key}` : '')
          : 'не делал';
        body += `<td class="${cell.status}" title="${esc(tip)}">${statusLabel[cell.status] || '?'}</td>`;
      }
    }
    body += '</tr>';
  }

  $app.innerHTML = `<div class="wrap">${topbar('Сравнение: ' + w.title, true)}
    <div class="legend">
      <span><i class="swatch match"></i> совпало</span>
      <span><i class="swatch mismatch"></i> не совпало</span>
      <span><i class="swatch missing"></i> не делал / не сдавал</span>
      <span><i class="swatch no_key"></i> нет ключа</span>
    </div>
    ${!cols.length ? '<div class="empty">Сначала добавьте детей</div>' : `
    <div class="matrix-wrap">
      <table class="matrix">
        <thead><tr><th class="sticky">№</th>
          ${cols.map((c) => `<th class="name">${esc(c.name)}${c.variant ? `<br><span class="mu">в${c.variant}</span>` : ''}</th>`).join('')}
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`}
  </div>`;
  bindChrome(() => { S.view = 'work'; render(); });
}

// ---------- Student ----------
async function renderStudentHome() {
  const [works, children] = await Promise.all([api('/works'), api('/children')]);
  $app.innerHTML = `<div class="wrap">${topbar('Мои работы')}
    <div class="card">
      <label class="lbl">Ваша фамилия</label>
      <select id="child">
        <option value="">Выберите…</option>
        ${children.map((c) =>
          `<option value="${c.id}" ${S.childId === c.id ? 'selected' : ''}>${esc(c.name)}</option>`
        ).join('')}
      </select>
    </div>
    <div id="list"></div>
  </div>`;
  bindChrome();

  document.getElementById('child').onchange = (e) => {
    S.childId = Number(e.target.value) || null;
    save();
  };

  const list = document.getElementById('list');
  if (!works.length) {
    list.innerHTML = '<div class="empty">Пока нет работ</div>';
    return;
  }
  list.innerHTML = works.map((w) => `
    <button type="button" class="list-item" data-id="${w.id}">
      <div style="flex:1;text-align:left">
        <b>${esc(w.title)}</b>
        <small>${fmtDate(w.date)} · ${w.task_count} заданий · ${w.variant_count} вар.</small>
      </div>
    </button>`).join('');
  list.onclick = (e) => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    if (!S.childId) { toast('Выберите фамилию'); return; }
    S.workId = Number(btn.dataset.id);
    S.view = 'submit';
    render();
  };
}

async function renderSubmit() {
  const data = await api(`/works/${S.workId}/mine?child_id=${S.childId}`);
  const w = data.work;
  let variant = data.submission?.variant || 1;
  const answers = data.answers || {};

  $app.innerHTML = `<div class="wrap">${topbar(w.title, true)}
    <p class="mu">${fmtDate(w.date)}</p>
    <div class="card">
      <label class="lbl">Вариант</label>
      <div class="tabs" id="tabs">
        ${Array.from({ length: w.variant_count }, (_, i) => i + 1).map((v) =>
          `<button type="button" data-v="${v}" class="${v === variant ? 'on' : ''}">Вариант ${v}</button>`
        ).join('')}
      </div>
    </div>
    <div class="tasks" id="tasks">
      ${Array.from({ length: w.task_count }, (_, i) => i + 1).map((n) => `
        <div class="task">
          <div class="num">${n}</div>
          <input data-n="${n}" value="${esc(answers[n] || '')}" placeholder="Ответ">
        </div>`).join('')}
    </div>
    <button type="button" id="save" style="width:100%;margin-top:14px">Сдать работу</button>
  </div>`;
  bindChrome(() => { S.view = 'home'; render(); });

  document.getElementById('tabs').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    variant = Number(b.dataset.v);
    document.querySelectorAll('#tabs button').forEach((x) =>
      x.classList.toggle('on', Number(x.dataset.v) === variant));
  };

  document.getElementById('save').onclick = async () => {
    const ans = {};
    document.querySelectorAll('#tasks input').forEach((inp) => {
      ans[inp.dataset.n] = inp.value;
    });
    try {
      await api('/works/' + S.workId + '/submit', {
        method: 'PUT',
        body: JSON.stringify({ child_id: S.childId, variant, answers: ans }),
      });
      toast('Сдано');
      S.view = 'home';
      render();
    } catch (e) { toast(e.message); }
  };
}

async function render() {
  if (!S.token) return renderLogin();
  try {
    if (S.role === 'teacher') {
      if (S.view === 'key' && S.workId) return await renderKey();
      if (S.view === 'matrix' && S.workId) return await renderMatrix();
      if (S.view === 'work' && S.workId) return await renderTeacherWork();
      return await renderTeacherHome();
    }
    if (S.view === 'submit' && S.workId && S.childId) return await renderSubmit();
    return await renderStudentHome();
  } catch (e) {
    toast(e.message);
    if (!S.token) return;
    S.view = 'home';
    $app.innerHTML = `<div class="wrap"><p class="err">${esc(e.message)}</p>
      <button type="button" id="retry">Обновить</button></div>`;
    document.getElementById('retry').onclick = () => render();
  }
}

render();
