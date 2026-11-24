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

const S = {
  token: null, role: null, name: null, childId: null, classId: null,
  portal: null, view: 'home', workId: null, classViewId: null, variant: 1,
  matrixClassId: null,
};
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
    token: S.token, role: S.role, name: S.name,
    childId: S.childId, classId: S.classId,
  }));
}

function confirmDlg({ title = 'Подтвердите', text = '', okLabel = 'Да', danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'confirm-dlg';
    dlg.innerHTML = `<h3>${esc(title)}</h3>
      ${text ? `<p class="dlg-text">${esc(text)}</p>` : ''}
      <div class="stack">
        <button value="ok" class="${danger ? 'danger' : ''}">${esc(okLabel)}</button>
        <button value="cancel" class="sec">Отмена</button>
      </div>`;
    document.body.appendChild(dlg);
    dlg.showModal();
    dlg.addEventListener('close', () => {
      resolve(dlg.returnValue === 'ok');
      dlg.remove();
    });
    dlg.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { dlg.close(b.value); };
    });
  });
}

/* ---- local drafts ---- */
function draftKey(kind, workId, variant, childId) {
  return `hw-draft:${kind}:${workId}:${variant}:${childId || 0}`;
}
function loadDraft(kind, workId, variant, childId) {
  try {
    return JSON.parse(localStorage.getItem(draftKey(kind, workId, variant, childId)) || 'null');
  } catch { return null; }
}
function saveDraft(kind, workId, variant, childId, answers) {
  localStorage.setItem(draftKey(kind, workId, variant, childId), JSON.stringify(answers));
}
function clearDraft(kind, workId, variant, childId) {
  localStorage.removeItem(draftKey(kind, workId, variant, childId));
}

async function api(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (S.token) headers.Authorization = `Bearer ${S.token}`;
  const res = await fetch('/api' + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    S.token = null; S.role = null; S.name = null; S.childId = null; save();
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
    S.token = null; S.role = null; S.name = null; S.childId = null;
    S.classId = null; S.workId = null; S.classViewId = null; save();
    render();
  };
  const b = document.getElementById('back');
  if (b && backFn) b.onclick = backFn;
}

function pathPortal() {
  const p = location.pathname.replace(/\/+$/, '') || '/';
  if (p === '/teacher' || p.startsWith('/teacher/')) return 'teacher';
  if (p === '/student' || p.startsWith('/student/')) return 'student';
  return null;
}
const loginPath = () => ({ path: location.pathname });
function portalRole() {
  if (S.portal === 'teacher' || S.portal === 'student') return S.portal;
  const fromPath = pathPortal();
  if (fromPath) return fromPath;
  const q = new URLSearchParams(location.search).get('role');
  if (q === 'teacher' || q === 'student') return q;
  return null;
}

// ---------- Login ----------
async function renderLogin() {
  const forced = portalRole();

  if (forced === 'student') return renderStudentLogin();

  if (forced === 'teacher') {
    $app.innerHTML = `<div class="wrap login">
      <h1>Проверка работ</h1>
      <p class="mu" style="margin:0 0 14px">Вход для учителя</p>
      <label class="lbl">ФИО</label>
      <input id="name" autocomplete="name" placeholder="Иванова И.И.">
      <label class="lbl">Код</label>
      <input id="secret" type="password" autocomplete="current-password" placeholder="Код доступа">
      <button type="button" id="go" style="width:100%">Войти</button>
      <div id="err" class="err" hidden></div>
    </div>`;
    const err = document.getElementById('err');
    document.getElementById('go').onclick = async () => {
      err.hidden = true;
      try {
        const data = await api('/login', {
          method: 'POST',
          body: JSON.stringify({
            role: 'teacher',
            name: document.getElementById('name').value,
            secret: document.getElementById('secret').value,
            ...loginPath(),
          }),
        });
        S.token = data.token; S.role = data.role; S.name = data.name;
        S.view = 'home'; save(); render();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    };
    return;
  }

  // локально без поддомена — выбор роли
  $app.innerHTML = `<div class="wrap login">
    <h1>Проверка работ</h1>
    <div class="seg" id="roles">
      <button type="button" data-r="teacher" class="on">Учитель</button>
      <button type="button" data-r="student">Ученик</button>
    </div>
    <div id="form"></div>
  </div>`;
  let current = 'teacher';
  const paint = () => {
    const form = document.getElementById('form');
    if (current === 'student') {
      renderStudentLoginInto(form);
      return;
    }
    form.innerHTML = `
      <label class="lbl">ФИО</label>
      <input id="name" autocomplete="name" placeholder="Иванова И.И.">
      <label class="lbl">Код</label>
      <input id="secret" type="password" autocomplete="current-password" placeholder="Код доступа">
      <button type="button" id="go" style="width:100%">Войти</button>
      <div id="err" class="err" hidden></div>`;
    const err = document.getElementById('err');
    document.getElementById('go').onclick = async () => {
      err.hidden = true;
      try {
        const data = await api('/login', {
          method: 'POST',
          body: JSON.stringify({
            role: 'teacher',
            name: document.getElementById('name').value,
            secret: document.getElementById('secret').value,
            ...loginPath(),
          }),
        });
        S.token = data.token; S.role = data.role; S.name = data.name;
        S.view = 'home'; save(); render();
      } catch (e) { err.textContent = e.message; err.hidden = false; }
    };
  };
  document.getElementById('roles').onclick = (e) => {
    const btn = e.target.closest('button[data-r]');
    if (!btn) return;
    current = btn.dataset.r;
    document.querySelectorAll('#roles button').forEach((b) => b.classList.toggle('on', b.dataset.r === current));
    paint();
  };
  paint();
}

function renderStudentLogin() {
  $app.innerHTML = `<div class="wrap login">
    <h1>Проверка работ</h1>
    <p class="mu" style="margin:0 0 14px">Вход для ученика</p>
    <div id="form"></div>
  </div>`;
  renderStudentLoginInto(document.getElementById('form'));
}

function renderStudentLoginInto(el) {
  el.innerHTML = `
    <label class="lbl">Фамилия</label>
    <div class="suggest-wrap">
      <input id="surname" autocomplete="off" placeholder="Начните вводить фамилию" enterkeyhint="search">
      <div class="suggest" id="suggest" hidden></div>
    </div>
    <div id="err" class="err" hidden></div>`;
  const input = document.getElementById('surname');
  const box = document.getElementById('suggest');
  const err = document.getElementById('err');
  let items = [];
  let timer;

  const pick = async (child) => {
    err.hidden = true;
    try {
      const data = await api('/login', {
        method: 'POST',
        body: JSON.stringify({ role: 'student', child_id: child.id, ...loginPath() }),
      });
      S.token = data.token; S.role = data.role; S.name = data.name;
      S.childId = data.childId; S.classId = data.classId;
      S.view = 'home'; save(); render();
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  };

  const show = (list) => {
    items = list;
    if (!list.length) {
      box.hidden = true;
      box.innerHTML = '';
      return;
    }
    box.hidden = false;
    box.innerHTML = list.map((c, i) =>
      `<button type="button" data-i="${i}" class="suggest-item">
        <b>${esc(c.name)}</b><small>${esc(c.class_name || '')}</small>
      </button>`
    ).join('');
  };

  const search = async () => {
    const q = input.value.trim();
    try {
      const rows = await fetch('/api/lookup/children?q=' + encodeURIComponent(q)).then((r) => r.json());
      show(rows);
    } catch { show([]); }
  };

  input.oninput = () => {
    clearTimeout(timer);
    timer = setTimeout(search, 120);
  };
  input.onfocus = () => { if (!items.length) search(); };
  box.onclick = (e) => {
    const btn = e.target.closest('[data-i]');
    if (!btn) return;
    pick(items[Number(btn.dataset.i)]);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter' && items.length === 1) {
      e.preventDefault();
      pick(items[0]);
    }
  };
}

// ---------- Teacher: classes ----------
function classChoices(classes, selectedIds, inputName) {
  return `<div class="class-choices">${classes.map((c) => `
    <label><input type="checkbox" name="${inputName}" value="${c.id}"
      ${selectedIds.has(c.id) ? 'checked' : ''}><span>${esc(c.name)} <small>(${c.children_count} уч.)</small></span></label>
  `).join('')}</div>`;
}

async function renderTeacherHome() {
  const [works, classes] = await Promise.all([api('/works'), api('/classes')]);
  $app.innerHTML = `<div class="wrap">${topbar('Работы')}<p class="mu">${esc(S.name)}</p>
    <div class="card" id="newWork">
      <label class="lbl">Новая работа</label>
      <input id="title" placeholder="Название">
      <div class="row" style="margin-top:8px">
        <div><label class="lbl">Дата</label><input id="date" type="date" value="${todayStr()}"></div>
        <div><label class="lbl">Заданий</label><input id="tasks" type="number" min="1" max="50" value="19"></div>
        <div><label class="lbl">Вариантов</label><input id="vars" type="number" min="1" max="10" value="2"></div>
      </div>
      <label class="lbl" style="margin-top:8px">Классы</label>
      ${classes.length
        ? classChoices(classes, new Set(), 'newClassIds')
        : '<p class="mu">Сначала создайте класс</p>'}
      <button type="button" id="create" style="width:100%;margin-top:10px" ${classes.length ? '' : 'disabled'}>Создать</button>
    </div>
    <div class="card">
      <div class="sec-h"><h2>Классы</h2></div>
      <form class="add" id="addClass">
        <input id="className" placeholder="Например, 5А" autocomplete="off">
        <button type="submit">Добавить</button>
      </form>
      <div id="classList"></div>
    </div>
    <div id="list"></div>
  </div>`;
  bindChrome();

  const classList = document.getElementById('classList');
  classList.innerHTML = classes.length
    ? classes.map((c) => `
      <button type="button" class="list-item" data-cid="${c.id}">
        <div style="flex:1;text-align:left">
          <b>${esc(c.name)}</b>
          <small>${c.children_count} уч.</small>
        </div>
      </button>`).join('')
    : '<span class="mu">Пока нет классов</span>';
  classList.onclick = (e) => {
    const btn = e.target.closest('[data-cid]');
    if (!btn) return;
    S.classViewId = Number(btn.dataset.cid);
    S.view = 'class';
    render();
  };

  document.getElementById('addClass').onsubmit = async (e) => {
    e.preventDefault();
    const name = document.getElementById('className').value;
    try {
      await api('/classes', { method: 'POST', body: JSON.stringify({ name }) });
      toast('Класс создан');
      renderTeacherHome();
    } catch (err) { toast(err.message); }
  };

  document.getElementById('create').onclick = async () => {
    try {
      const body = {
        title: document.getElementById('title').value,
        date: document.getElementById('date').value,
        task_count: Number(document.getElementById('tasks').value),
        variant_count: Number(document.getElementById('vars').value),
        class_ids: [...document.querySelectorAll('input[name="newClassIds"]:checked')].map((el) => Number(el.value)),
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
        <small>${fmtDate(w.date)} · ${esc(w.class_names || '—')} · заданий ${w.task_count}
          · вар. ${w.variant_count} · сдач ${w.submissions} · ответов ${w.keyed_variants}/${w.variant_count}</small>
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

async function renderClass() {
  const data = await api('/classes/' + S.classViewId + '/children');
  const cls = data.class;
  const children = data.children;

  $app.innerHTML = `<div class="wrap">${topbar(cls.name, true)}
    <p class="mu">${children.length} учеников</p>
    <div class="card">
      <form class="add" id="addChild">
        <input id="childName" placeholder="Фамилия" autocomplete="off" enterkeyhint="done">
        <button type="submit">Добавить</button>
      </form>
      <div class="chip-row" id="children"></div>
    </div>
    <button type="button" class="danger" id="delClass" style="width:100%">Удалить класс</button>
  </div>`;
  bindChrome(() => { S.view = 'home'; S.classViewId = null; render(); });

  const chBox = document.getElementById('children');
  chBox.innerHTML = children.length
    ? children.map((c) => `<span class="chip">${esc(c.name)}
        <button type="button" data-del="${c.id}" aria-label="Удалить">×</button></span>`).join('')
    : '<span class="mu">Пока никого</span>';
  chBox.onclick = async (e) => {
    const id = e.target.dataset?.del;
    if (!id) return;
    if (!(await confirmDlg({
      title: 'Удалить ученика?',
      text: 'Будут удалены все его сдачи.',
      okLabel: 'Удалить',
      danger: true,
    }))) return;
    await api('/children/' + id, { method: 'DELETE' });
    toast('Удалено');
    renderClass();
  };

  const form = document.getElementById('addChild');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById('childName');
    const name = input.value.trim();
    if (!name) return;
    try {
      await api('/classes/' + S.classViewId + '/children', {
        method: 'POST',
        body: JSON.stringify({ name }),
      });
      toast('Добавлен');
      await renderClass();
      document.getElementById('childName')?.focus();
    } catch (err) { toast(err.message); }
  };

  document.getElementById('delClass').onclick = async () => {
    if (!(await confirmDlg({
      title: 'Удалить класс?',
      text: 'Ученики и их сдачи будут удалены.',
      okLabel: 'Удалить',
      danger: true,
    }))) return;
    await api('/classes/' + S.classViewId, { method: 'DELETE' });
    S.classViewId = null; S.view = 'home';
    toast('Удалено');
    render();
  };
}

// ---------- Teacher work ----------
async function renderTeacherWork() {
  const [data, classes] = await Promise.all([api('/works/' + S.workId), api('/classes')]);
  const w = data.work;
  const classNames = (data.classes || []).map((c) => c.name).join(', ') || '—';
  const assignedIds = new Set((data.classes || []).map((c) => c.id));
  $app.innerHTML = `<div class="wrap">${topbar(w.title, true)}
    <p class="mu">${fmtDate(w.date)} · ${esc(classNames)} · ${w.task_count} заданий · ${w.variant_count} вар.</p>
    <div class="stack">
      <button type="button" id="toKey">Заполнить ответы</button>
      <button type="button" id="toMatrix" class="sec">Результаты</button>
      <div class="card" style="margin:0">
        <label class="lbl">Назначенные классы</label>
        <div class="chip-row" id="assignedClasses">
          ${(data.classes || []).map((c) => `<span class="chip">${esc(c.name)}
            <button type="button" data-remove-class="${c.id}" aria-label="Убрать класс ${esc(c.name)}">×</button>
          </span>`).join('') || '<span class="mu">Классы не назначены</span>'}
        </div>
        <div class="suggest-wrap" style="margin:10px 0 0">
          <input id="classSearch" placeholder="Найти класс и добавить" autocomplete="off" aria-label="Найти класс">
          <div class="suggest" id="classSuggest" hidden></div>
        </div>
        <p class="mu" style="margin:8px 0 0">При удалении всех классов работа исчезнет у учеников, но останется у учителя; сданные ответы сохранятся.</p>
      </div>
      <button type="button" id="delWork" class="danger">Удалить работу</button>
    </div>
  </div>`;
  bindChrome(() => { S.view = 'home'; render(); });
  document.getElementById('toKey').onclick = () => { S.view = 'key'; render(); };
  document.getElementById('toMatrix').onclick = () => {
    S.matrixClassId = null;
    S.view = 'matrix';
    render();
  };
  const classSearch = document.getElementById('classSearch');
  const classSuggest = document.getElementById('classSuggest');
  let savingClasses = false;
  const availableClasses = () => classes.filter((c) => !assignedIds.has(c.id));
  const showClassSuggestions = () => {
    const query = classSearch.value.trim().toLowerCase();
    const matches = availableClasses().filter((c) => c.name.toLowerCase().includes(query));
    classSuggest.innerHTML = matches.map((c) =>
      `<button type="button" class="suggest-item" data-add-class="${c.id}">${esc(c.name)}</button>`
    ).join('') || '<span class="suggest-empty">Класс не найден</span>';
    classSuggest.hidden = !query || savingClasses;
  };
  const updateClasses = async (nextIds, added) => {
    if (savingClasses) return;
    savingClasses = true;
    classSearch.disabled = true;
    classSuggest.hidden = true;
    try {
      await api('/works/' + S.workId + '/classes', {
        method: 'PUT',
        body: JSON.stringify({ class_ids: [...nextIds] }),
      });
      await renderTeacherWork();
      if (added) document.getElementById('classSearch')?.focus();
      toast(added ? 'Класс добавлен' : 'Класс убран');
    } catch (e) {
      savingClasses = false;
      classSearch.disabled = false;
      toast(e.message);
    }
  };
  classSearch.addEventListener('input', showClassSuggestions);
  classSearch.addEventListener('focus', showClassSuggestions);
  classSearch.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') classSuggest.hidden = true;
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const first = classSuggest.querySelector('[data-add-class]');
    if (first && !classSuggest.hidden) first.click();
  });
  classSuggest.onclick = (e) => {
    const button = e.target.closest('[data-add-class]');
    if (!button) return;
    const id = Number(button.dataset.addClass);
    updateClasses(new Set([...assignedIds, id]), true);
  };
  document.getElementById('assignedClasses').onclick = (e) => {
    const button = e.target.closest('[data-remove-class]');
    if (!button) return;
    const nextIds = new Set(assignedIds);
    nextIds.delete(Number(button.dataset.removeClass));
    updateClasses(nextIds, false);
  };
  document.addEventListener('click', function closeClassSuggestions(e) {
    if (!classSearch.isConnected) {
      document.removeEventListener('click', closeClassSuggestions);
      return;
    }
    if (!e.target.closest('.suggest-wrap')) classSuggest.hidden = true;
  });
  document.getElementById('delWork').onclick = async () => {
    if (!(await confirmDlg({
      title: 'Удалить работу?',
      text: 'Все ответы учеников будут удалены.',
      okLabel: 'Удалить',
      danger: true,
    }))) return;
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
    const serverKeys = (data.keys && data.keys[variant]) || {};
    const draft = loadDraft('key', S.workId, variant, null);
    const keys = draft || serverKeys;

    $app.innerHTML = `<div class="wrap">${topbar('Ответы: ' + w.title, true)}
      <div class="tabs" id="tabs">
        ${Array.from({ length: w.variant_count }, (_, i) => i + 1).map((v) =>
          `<button type="button" data-v="${v}" class="${v === variant ? 'on' : ''}">Вариант ${v}</button>`
        ).join('')}
      </div>
      ${draft ? '<p class="mu draft-note">Черновик на этом устройстве — нажмите «Сохранить»</p>' : ''}
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
    const persistLocal = () => {
      const answers = {};
      document.querySelectorAll('#tasks input').forEach((inp) => {
        answers[inp.dataset.n] = inp.value;
      });
      saveDraft('key', S.workId, variant, null, answers);
    };
    document.querySelectorAll('#tasks input').forEach((inp) => {
      inp.addEventListener('input', persistLocal);
    });
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
        clearDraft('key', S.workId, variant, null);
        toast('Сохранено');
        paint();
      } catch (e) { toast(e.message); }
    };
  }
  paint();
}

function matrixTotals(w, cols) {
  const perChild = cols.map((col) => {
    if (!col.cells) return null;
    return col.cells.reduce((n, c) => n + (c.status === 'match' ? 1 : 0), 0);
  });
  const perTask = Array.from({ length: w.task_count }, (_, i) =>
    cols.reduce((n, col) => n + (col.cells?.[i]?.status === 'match' ? 1 : 0), 0)
  );
  return { perChild, perTask };
}

function downloadMatrixExcel(w, classResults, allClasses = false) {
  const enc = new TextEncoder();
  const u16 = (n) => { const b = new Uint8Array(2); new DataView(b.buffer).setUint16(0, n, true); return b; };
  const u32 = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n, true); return b; };
  const cat = (parts) => {
    const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    return out;
  };
  const CRC = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      t[i] = c >>> 0;
    }
    return (data) => {
      let c = 0xffffffff;
      for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 255] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
  })();
  const zipStore = (files) => {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name);
      const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data;
      const crc = CRC(data);
      const local = cat([
        u32(0x04034b50), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length), u16(0),
        name, data,
      ]);
      locals.push(local);
      centrals.push(cat([
        u32(0x02014b50), u16(20), u16(20), u16(0), u16(0), u16(0), u16(0),
        u32(crc), u32(data.length), u32(data.length), u16(name.length),
        u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name,
      ]));
      offset += local.length;
    }
    const central = cat(centrals);
    const end = cat([
      u32(0x06054b50), u16(0), u16(0), u16(files.length), u16(files.length),
      u32(central.length), u32(offset), u16(0),
    ]);
    return cat([...locals, central, end]);
  };

  const xmlEsc = (s) => String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const colLetter = (i) => {
    let n = i; let s = '';
    while (n >= 0) { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; }
    return s;
  };
  // 0 default, 1 header/tot, 2 match, 3 mismatch, 4 missed, 5 blank
  const styleOf = { match: 2, mismatch: 3, missed: 4, blank: 5, unchecked: 5 };
  const totCol = w.task_count + 1;
  const inline = (ref, text, style) => {
    if (text === '' || text == null) return `<c r="${ref}" s="${style}"/>`;
    if (typeof text === 'number') return `<c r="${ref}" s="${style}"><v>${text}</v></c>`;
    if (/^-?\d+(\.\d+)?$/.test(String(text)) && String(text).length < 16) {
      return `<c r="${ref}" s="${style}"><v>${text}</v></c>`;
    }
    return `<c r="${ref}" t="inlineStr" s="${style}"><is><t>${xmlEsc(text)}</t></is></c>`;
  };

  const buildSheet = (cols) => {
  const { perChild, perTask } = matrixTotals(w, cols);
  const sheetRows = [];
  {
    let cells = inline('A1', 'Фамилия', 1);
    for (let n = 1; n <= w.task_count; n++) cells += inline(colLetter(n) + '1', `Задание ${n}`, 1);
    cells += inline(colLetter(totCol) + '1', 'Верно', 1);
    sheetRows.push(`<row r="1">${cells}</row>`);
  }
  cols.forEach((col, i) => {
    const r = i + 2;
    let cells = inline(`A${r}`, col.name, 1);
    for (let n = 1; n <= w.task_count; n++) {
      const ref = colLetter(n) + r;
      if (!col.cells) cells += inline(ref, '', 5);
      else {
        const cell = col.cells[n - 1];
        const text = cell.student != null ? cell.student : (cell.status === 'missed' ? '—' : '');
        cells += inline(ref, text, styleOf[cell.status] || 5);
      }
    }
    cells += inline(colLetter(totCol) + r, perChild[i] == null ? '' : perChild[i], 1);
    sheetRows.push(`<row r="${r}">${cells}</row>`);
  });
  {
    const r = cols.length + 2;
    let cells = inline(`A${r}`, 'Итого верно', 1);
    perTask.forEach((total, i) => {
      cells += inline(colLetter(i + 1) + r, total, 1);
    });
    cells += inline(colLetter(totCol) + r, '', 1);
    sheetRows.push(`<row r="${r}">${cells}</row>`);
  }

  const colXml = [`<col min="1" max="1" width="24" customWidth="1"/>`]
    .concat(Array.from({ length: w.task_count }, (_, i) => `<col min="${i + 2}" max="${i + 2}" width="12" customWidth="1"/>`))
    .concat([`<col min="${totCol + 1}" max="${totCol + 1}" width="10" customWidth="1"/>`])
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <cols>${colXml}</cols>
  <sheetData>${sheetRows.join('')}</sheetData>
</worksheet>`;
  };

  const thin = `<left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="6">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFE3F3EC"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFDECEA"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFF7E8B8"/></patternFill></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFFFFF"/></patternFill></fill>
  </fills>
  <borders count="2">
    <border/>
    <border>${thin}</border>
  </borders>
  <cellXfs count="6">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="1" applyBorder="1"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="1" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" wrapText="1"/></xf>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="3" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="4" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
    <xf numFmtId="0" fontId="0" fillId="5" borderId="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center"/></xf>
  </cellXfs>
</styleSheet>`;

  const usedSheetNames = new Set();
  const sheets = classResults.map((result, i) => {
    const rawName = allClasses ? result.className : 'Результаты';
    const base = String(rawName || 'Класс').replace(/[\[\]:*?/\\\x00-\x1f]/g, '_')
      .trim().replace(/^'+|'+$/g, '').trim() || 'Класс';
    let name = base.slice(0, 31).replace(/'+$/g, '') || 'Класс';
    for (let n = 2; usedSheetNames.has(name.toLowerCase()); n++) {
      const suffix = ` (${n})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    usedSheetNames.add(name.toLowerCase());
    return { name, xml: buildSheet(result.columns), index: i + 1 };
  });
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheets.map((s) => `<Override PartName="/xl/worksheets/sheet${s.index}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>` },
    { name: '_rels/.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>` },
    { name: 'xl/workbook.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>${sheets.map((s) => `<sheet name="${xmlEsc(s.name)}" sheetId="${s.index}" r:id="rId${s.index}"/>`).join('')}</sheets>
</workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${sheets.map((s) => `<Relationship Id="rId${s.index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${s.index}.xml"/>`).join('')}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>` },
    ...sheets.map((s) => ({ name: `xl/worksheets/sheet${s.index}.xml`, data: s.xml })),
    { name: 'xl/styles.xml', data: styles },
  ];

  const blob = new Blob([zipStore(files)], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  const safe = (s) => String(s).replace(/[\\/:*?"<>|]+/g, '_');
  a.download = `${safe(w.title)}_${safe(w.date)}${allClasses ? '_все_классы' : classResults.length ? '_' + safe(classResults[0].className) : ''}.xlsx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

async function renderMatrix() {
  const data = await api('/works/' + S.workId + '/matrix' +
    (S.matrixClassId == null ? '' : '?class_id=' + S.matrixClassId));
  const w = data.work;
  const cols = data.columns;
  S.matrixClassId = data.selected_class_id;
  const activeClass = data.classes.find((c) => c.id === data.selected_class_id);
  const { perChild, perTask } = matrixTotals(w, cols);
  const statusLabel = { match: '✓', mismatch: '✗', missed: '—', unchecked: '·' };

  let body = '';
  for (let n = 1; n <= w.task_count; n++) {
    body += `<tr><td class="sticky">${n}</td>`;
    for (const col of cols) {
      if (!col.cells) {
        body += `<td class="blank" title="Не сдавал"></td>`;
      } else {
        const cell = col.cells[n - 1];
        const tip = cell.student != null
          ? `ответ: ${cell.student}` + (cell.key != null ? ` | ключ: ${cell.key}` : '')
          : 'не делал';
        body += `<td class="${cell.status}" title="${esc(tip)}">${statusLabel[cell.status] || ''}</td>`;
      }
    }
    body += `<td class="tot" title="Сколько человек сделали верно">${perTask[n - 1]}</td></tr>`;
  }
  body += `<tr class="totals"><td class="sticky">Итого</td>`;
  for (const v of perChild) {
    body += `<td class="tot">${v == null ? '' : v}</td>`;
  }
  body += `<td class="tot"></td></tr>`;

  $app.innerHTML = `<div class="wrap">${topbar('Результаты: ' + w.title, true)}
    ${data.classes.length > 1 ? `<div class="tabs" id="classTabs" role="tablist" aria-label="Класс">
      ${data.classes.map((c) => `<button type="button" role="tab" data-class-id="${c.id}"
        aria-selected="${c.id === data.selected_class_id}" class="${c.id === data.selected_class_id ? 'on' : ''}">${esc(c.name)}</button>`).join('')}
    </div>` : ''}
    <div class="legend">
      <span><i class="swatch match"></i> совпало</span>
      <span><i class="swatch mismatch"></i> не совпало</span>
      <span><i class="swatch missed"></i> не делал</span>
      <span><i class="swatch blank"></i> не сдавал</span>
    </div>
    ${!activeClass ? '<div class="empty">Работа не назначена ни одному классу</div>' : `
    <button type="button" class="sec" id="xls" style="width:100%;margin-bottom:10px">Скачать Excel</button>
    ${data.classes.length > 1 ? '<button type="button" class="sec" id="xlsAll" style="width:100%;margin-bottom:10px">Скачать все классы</button>' : ''}
    ${!cols.length ? '<div class="empty">В этом классе нет учеников</div>' : `
    <div class="matrix-wrap">
      <table class="matrix">
        <thead><tr><th class="sticky">№</th>
          ${cols.map((c) => `<th class="name">${esc(c.name)}${
            c.variant ? `<br><span class="mu">в${c.variant}</span>` : ''
          }</th>`).join('')}
          <th class="tot">Верно</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
    </div>`}`}
  </div>`;
  bindChrome(() => { S.view = 'work'; render(); });
  const classTabs = document.getElementById('classTabs');
  if (classTabs) classTabs.onclick = (e) => {
    const tab = e.target.closest('[data-class-id]');
    if (!tab || Number(tab.dataset.classId) === S.matrixClassId) return;
    S.matrixClassId = Number(tab.dataset.classId);
    renderMatrix();
  };
  const xls = document.getElementById('xls');
  if (xls) xls.onclick = () => {
    downloadMatrixExcel(w, [{ className: activeClass.name, columns: cols }]);
    toast('Файл скачан');
  };
  const xlsAll = document.getElementById('xlsAll');
  if (xlsAll) xlsAll.onclick = async () => {
    xlsAll.disabled = true;
    xlsAll.textContent = 'Готовим Excel…';
    try {
      const results = await Promise.all(data.classes.map(async (c) => ({
        className: c.name,
        columns: c.id === data.selected_class_id ? cols :
          (await api('/works/' + S.workId + '/matrix?class_id=' + c.id)).columns,
      })));
      downloadMatrixExcel(w, results, true);
      toast('Файл скачан');
    } catch (e) { toast(e.message); }
    finally {
      xlsAll.disabled = false;
      xlsAll.textContent = 'Скачать все классы';
    }
  };
}

// ---------- Student ----------
async function renderStudentHome() {
  const works = await api('/works');
  $app.innerHTML = `<div class="wrap">${topbar('Мои работы')}
    <p class="mu">${esc(S.name)}</p>
    <div id="list"></div>
  </div>`;
  bindChrome();

  const list = document.getElementById('list');
  if (!works.length) {
    list.innerHTML = '<div class="empty">Пока нет доступных работ</div>';
    return;
  }
  list.innerHTML = works.map((w) => `
    <button type="button" class="list-item ${w.done ? 'done' : ''}" data-id="${w.id}">
      <div style="flex:1;text-align:left">
        <b>${esc(w.title)}</b>
        <small>${fmtDate(w.date)} · ${w.task_count} заданий · ${w.variant_count} вар.
          ${w.done ? ' · сдано' : ''}</small>
      </div>
      <span class="badge ${w.done ? 'ok' : 'todo'}">${w.done ? 'Сдано' : 'Открыто'}</span>
    </button>`).join('');
  list.onclick = (e) => {
    const btn = e.target.closest('[data-id]');
    if (!btn) return;
    S.workId = Number(btn.dataset.id);
    S.view = 'pickVariant';
    render();
  };
}

async function renderPickVariant() {
  const data = await api(`/works/${S.workId}/mine`);
  const w = data.work;
  const done = !!data.submission?.submitted_at;

  if (done) {
    S.view = 'submit';
    return renderSubmit();
  }

  $app.innerHTML = `<div class="wrap">${topbar(w.title, true)}
    <p class="mu">${fmtDate(w.date)} · выберите вариант</p>
    <div class="stack" id="vars">
      ${Array.from({ length: w.variant_count }, (_, i) => i + 1).map((v) =>
        `<button type="button" data-v="${v}" class="sec var-pick">Вариант ${v}</button>`
      ).join('')}
    </div>
  </div>`;
  bindChrome(() => { S.view = 'home'; render(); });
  document.getElementById('vars').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    S.variant = Number(b.dataset.v);
    S.view = 'submit';
    render();
  };
}

async function renderSubmit() {
  const data = await api(`/works/${S.workId}/mine`);
  const w = data.work;
  const done = !!data.submission?.submitted_at;
  let variant = done ? (data.submission.variant || 1) : (S.variant || 1);
  if (variant > w.variant_count) variant = 1;

  const serverAns = data.answers || {};
  const draft = !done ? loadDraft('ans', S.workId, variant, S.childId) : null;
  const answers = draft || serverAns;

  $app.innerHTML = `<div class="wrap">${topbar(w.title, true)}
    <p class="mu">${fmtDate(w.date)} · вариант ${variant}${done ? ' · сдано' : ''}</p>
    ${!done && draft ? '<p class="mu draft-note">Черновик сохранён на этом устройстве</p>' : ''}
    ${done ? '<p class="banner info">Работа сдана. Менять ответы нельзя.</p>' : ''}
    <div class="tasks" id="tasks">
      ${Array.from({ length: w.task_count }, (_, i) => i + 1).map((n) => `
        <div class="task">
          <div class="num">${n}</div>
          <input data-n="${n}" value="${esc(answers[n] || '')}" placeholder="Ответ" ${done ? 'disabled' : ''}>
        </div>`).join('')}
    </div>
    ${done ? '' : `<button type="button" id="save" style="width:100%;margin-top:14px">Сдать работу</button>`}
  </div>`;
  bindChrome(() => {
    S.view = done ? 'home' : 'pickVariant';
    render();
  });

  if (!done) {
    const persistLocal = () => {
      const ans = {};
      document.querySelectorAll('#tasks input').forEach((inp) => {
        ans[inp.dataset.n] = inp.value;
      });
      saveDraft('ans', S.workId, variant, S.childId, ans);
    };
    document.querySelectorAll('#tasks input').forEach((inp) => {
      inp.addEventListener('input', persistLocal);
    });
    document.getElementById('save').onclick = async () => {
      const ok = await confirmDlg({
        title: 'Сдать работу?',
        text: 'После сдачи изменить ответы будет нельзя.',
        okLabel: 'Сдать',
      });
      if (!ok) return;
      const ans = {};
      document.querySelectorAll('#tasks input').forEach((inp) => {
        ans[inp.dataset.n] = inp.value;
      });
      try {
        await api('/works/' + S.workId + '/submit', {
          method: 'PUT',
          body: JSON.stringify({ child_id: S.childId, variant, answers: ans }),
        });
        clearDraft('ans', S.workId, variant, S.childId);
        toast('Сдано');
        S.view = 'home';
        render();
      } catch (e) { toast(e.message); }
    };
  }
}

async function render() {
  if (!S.token) return renderLogin();
  if (S.role === 'student' && !S.childId) {
    S.token = null; S.role = null; S.name = null; save();
    return renderLogin();
  }
  try {
    if (S.role === 'teacher') {
      if (S.view === 'class' && S.classViewId) return await renderClass();
      if (S.view === 'key' && S.workId) return await renderKey();
      if (S.view === 'matrix' && S.workId) return await renderMatrix();
      if (S.view === 'work' && S.workId) return await renderTeacherWork();
      return await renderTeacherHome();
    }
    if (S.view === 'submit' && S.workId && S.childId) return await renderSubmit();
    if (S.view === 'pickVariant' && S.workId && S.childId) return await renderPickVariant();
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

(async () => {
  try {
    const qs = new URLSearchParams(location.search);
    if (!qs.has('path')) qs.set('path', location.pathname);
    const p = await fetch('/api/portal?' + qs.toString()).then((r) => r.json());
    S.portal = pathPortal() || p.role;
  } catch { S.portal = pathPortal(); }
  // если на student-портале сидит учительский токен — сбросить
  if (S.portal && S.role && S.portal !== S.role) {
    S.token = null; S.role = null; S.name = null; S.childId = null; save();
  }
  render();
})();


// ---------- PWA ----------
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
