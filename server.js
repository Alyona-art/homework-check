const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { TEACHER_CODE, SECRET } = process.env;
if (!TEACHER_CODE || !SECRET) {
  console.error('Задайте TEACHER_CODE, SECRET (см. .env.example)');
  process.exit(1);
}
const PORT = process.env.PORT || 3001;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'homework.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS classes(
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS children(
  id INTEGER PRIMARY KEY,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  name TEXT NOT NULL COLLATE NOCASE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(class_id, name COLLATE NOCASE));
CREATE TABLE IF NOT EXISTS works(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  task_count INTEGER NOT NULL CHECK(task_count >= 1 AND task_count <= 50),
  variant_count INTEGER NOT NULL DEFAULT 2 CHECK(variant_count >= 1 AND variant_count <= 10),
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS work_classes(
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY(work_id, class_id));
CREATE TABLE IF NOT EXISTS keys(
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  variant INTEGER NOT NULL,
  task_no INTEGER NOT NULL,
  answer TEXT NOT NULL,
  PRIMARY KEY(work_id, variant, task_no));
CREATE TABLE IF NOT EXISTS submissions(
  id INTEGER PRIMARY KEY,
  work_id INTEGER NOT NULL REFERENCES works(id) ON DELETE CASCADE,
  child_id INTEGER NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  variant INTEGER NOT NULL,
  submitted_at TEXT,
  UNIQUE(work_id, child_id));
CREATE TABLE IF NOT EXISTS answers(
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  task_no INTEGER NOT NULL,
  answer TEXT NOT NULL,
  PRIMARY KEY(submission_id, task_no));
`);

(function migrate() {
  const childCols = db.prepare('PRAGMA table_info(children)').all();
  const hasClassId = childCols.some((c) => c.name === 'class_id');
  if (!hasClassId) {
    db.exec('ALTER TABLE children ADD COLUMN class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE');
  }
  const orphans = db.prepare('SELECT COUNT(*) AS n FROM children WHERE class_id IS NULL').get().n;
  if (orphans) {
    let cls = db.prepare('SELECT id FROM classes WHERE name=?').get('Без класса');
    if (!cls) {
      const r = db.prepare('INSERT INTO classes(name) VALUES(?)').run('Без класса');
      cls = { id: Number(r.lastInsertRowid) };
    }
    db.prepare('UPDATE children SET class_id=? WHERE class_id IS NULL').run(cls.id);
  }
  // убрать старый UNIQUE(name), оставить UNIQUE(class_id, name)
  const idx = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='children'").get();
  if (idx?.sql && /name TEXT UNIQUE/i.test(idx.sql)) {
    db.exec('PRAGMA foreign_keys = OFF');
    db.exec(`
      CREATE TABLE children_new(
        id INTEGER PRIMARY KEY,
        class_id INTEGER NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
        name TEXT NOT NULL COLLATE NOCASE,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(class_id, name COLLATE NOCASE));
      INSERT INTO children_new(id,class_id,name,created_at)
        SELECT id, class_id, name, created_at FROM children WHERE class_id IS NOT NULL;
      DROP TABLE children;
      ALTER TABLE children_new RENAME TO children;
    `);
    db.exec('PRAGMA foreign_keys = ON');
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS children_class_name
      ON children(class_id, name COLLATE NOCASE)
  `);
})();

function withTx(fn) {
  db.exec('BEGIN');
  try { fn(); db.exec('COMMIT'); }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

const b64 = (b) => Buffer.from(b).toString('base64url');
const sign = (s) => crypto.createHmac('sha256', SECRET).update(s).digest('base64url');
const makeToken = (p) => {
  const body = b64(JSON.stringify({ ...p, exp: Date.now() + 90 * 864e5 }));
  return body + '.' + sign(body);
};
function readToken(t) {
  if (!t) return null;
  const [body, sig] = t.split('.');
  if (!body || !sig || sig !== sign(body)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url'));
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const safeEq = (a, b) => {
  const h = (x) => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

function clean(s) { return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80); }
const titleCase = (s) => clean(s).toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
const validDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(d || '');
function normAnswer(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/[ё]/g, 'е');
}

/** teacher.* / student.* / /teacher /student / ?role= */
function portalFromPath(p) {
  const path = String(p || '').split('?')[0].replace(/\/+$/, '') || '/';
  if (path === '/teacher' || path.startsWith('/teacher/')) return 'teacher';
  if (path === '/student' || path.startsWith('/student/')) return 'student';
  return null;
}
function detectPortal(req) {
  const host = String(req.hostname || '').toLowerCase();
  if (host === 'teacher' || host.startsWith('teacher.')) return 'teacher';
  if (host === 'student' || host.startsWith('student.')) return 'student';
  const byPath = portalFromPath(req.query?.path) || portalFromPath(req.path);
  if (byPath) return byPath;
  const q = String(req.query?.role || '').toLowerCase();
  if (q === 'teacher' || q === 'student') return q;
  return null;
}

const fails = new Map();
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

app.get('/api/portal', (req, res) => {
  res.json({ role: detectPortal(req) });
});

/** Публичный список фамилий для входа ученика */
app.get('/api/lookup/children', (req, res) => {
  const q = clean(req.query?.q).toLowerCase();
  const rows = db.prepare(`
    SELECT c.id, c.name, cl.name AS class_name
    FROM children c JOIN classes cl ON cl.id=c.class_id
    ORDER BY c.name COLLATE NOCASE
  `).all();
  // JS toLowerCase — sqlite lower() не умеет кириллицу
  const filtered = q
    ? rows.filter((r) => r.name.toLowerCase().startsWith(q))
    : rows;
  res.json(filtered.slice(0, 40));
});

app.post('/api/login', (req, res) => {
  const portal = detectPortal(req) || portalFromPath(req.body?.path);
  const ip = req.ip;
  const f = fails.get(ip);
  if (f && f.n >= 10 && f.until > Date.now()) {
    return res.status(429).json({ error: 'Слишком много попыток, подождите 10 минут' });
  }
  const { role, secret } = req.body || {};
  if (portal && role && role !== portal) {
    return res.status(403).json({ error: 'Неверный портал' });
  }
  const effectiveRole = portal || role;
  if (effectiveRole === 'teacher') {
    const name = clean(req.body?.name);
    if (!name || !safeEq(secret, TEACHER_CODE)) {
      fails.set(ip, { n: (f?.n || 0) + 1, until: Date.now() + 10 * 60e3 });
      return res.status(401).json({ error: !name ? 'Введите ФИО' : 'НЕВЕРНЫЙ КОД' });
    }
    fails.delete(ip);
    return res.json({ token: makeToken({ role: 'teacher', name }), role: 'teacher', name });
  }
  if (effectiveRole === 'student') {
    const childId = parseInt(req.body?.child_id, 10);
    const child = db.prepare(`
      SELECT c.id, c.name, c.class_id, cl.name AS class_name
      FROM children c JOIN classes cl ON cl.id=c.class_id WHERE c.id=?
    `).get(childId);
    if (!child) {
      fails.set(ip, { n: (f?.n || 0) + 1, until: Date.now() + 10 * 60e3 });
      return res.status(401).json({ error: 'Выберите фамилию из списка' });
    }
    fails.delete(ip);
    return res.json({
      token: makeToken({
        role: 'student',
        name: child.name,
        childId: child.id,
        classId: child.class_id,
      }),
      role: 'student',
      name: child.name,
      childId: child.id,
      classId: child.class_id,
      className: child.class_name,
    });
  }
  return res.status(400).json({ error: 'Укажите роль' });
});

app.use('/api', (req, res, next) => {
  if (req.path === '/portal' || req.path === '/lookup/children' || req.path === '/login') return next();
  const u = readToken((req.headers.authorization || '').replace('Bearer ', ''));
  if (!u) return res.status(401).json({ error: 'Нужно войти' });
  req.user = u;
  next();
});

const teacherOnly = (req, res, next) =>
  req.user.role === 'teacher' ? next() : res.status(403).json({ error: 'Только для учителя' });

function getWork(id) {
  return db.prepare('SELECT * FROM works WHERE id=?').get(id);
}

function workClasses(workId) {
  return db.prepare(`
    SELECT cl.id, cl.name FROM classes cl
    JOIN work_classes wc ON wc.class_id=cl.id
    WHERE wc.work_id=?
    ORDER BY cl.name COLLATE NOCASE
  `).all(workId);
}

// ---------- Классы ----------
app.get('/api/classes', teacherOnly, (req, res) => {
  const rows = db.prepare(`
    SELECT cl.*,
      (SELECT COUNT(*) FROM children ch WHERE ch.class_id=cl.id) AS children_count
    FROM classes cl
    ORDER BY cl.name COLLATE NOCASE
  `).all();
  res.json(rows);
});

app.post('/api/classes', teacherOnly, (req, res) => {
  const name = clean(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Введите название класса' });
  try {
    const r = db.prepare('INSERT INTO classes(name) VALUES(?)').run(name);
    res.json({ id: Number(r.lastInsertRowid), name });
  } catch {
    res.status(409).json({ error: 'Такой класс уже есть' });
  }
});

app.patch('/api/classes/:id', teacherOnly, (req, res) => {
  const name = clean(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Введите название' });
  try {
    const r = db.prepare('UPDATE classes SET name=? WHERE id=?').run(name, req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Не найден' });
    res.json({ ok: true, name });
  } catch {
    res.status(409).json({ error: 'Такой класс уже есть' });
  }
});

app.delete('/api/classes/:id', teacherOnly, (req, res) => {
  const r = db.prepare('DELETE FROM classes WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true });
});

app.get('/api/classes/:id/children', teacherOnly, (req, res) => {
  const cls = db.prepare('SELECT * FROM classes WHERE id=?').get(req.params.id);
  if (!cls) return res.status(404).json({ error: 'Класс не найден' });
  const children = db.prepare(
    'SELECT id, name FROM children WHERE class_id=? ORDER BY name COLLATE NOCASE'
  ).all(cls.id);
  res.json({ class: cls, children });
});

app.post('/api/classes/:id/children', teacherOnly, (req, res) => {
  const cls = db.prepare('SELECT id FROM classes WHERE id=?').get(req.params.id);
  if (!cls) return res.status(404).json({ error: 'Класс не найден' });
  const name = titleCase(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Введите фамилию' });
  try {
    const r = db.prepare('INSERT INTO children(class_id,name) VALUES(?,?)').run(cls.id, name);
    res.json({ id: Number(r.lastInsertRowid), name });
  } catch {
    res.status(409).json({ error: 'Такая фамилия уже есть в классе' });
  }
});

app.delete('/api/children/:id', teacherOnly, (req, res) => {
  const r = db.prepare('DELETE FROM children WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true });
});

/** Все фамилии (учитель) — для подсказок */
app.get('/api/children', (req, res) => {
  if (req.user.role === 'student') {
    return res.json([{ id: req.user.childId, name: req.user.name }]);
  }
  const rows = db.prepare(`
    SELECT c.id, c.name, c.class_id, cl.name AS class_name
    FROM children c JOIN classes cl ON cl.id=c.class_id
    ORDER BY cl.name COLLATE NOCASE, c.name COLLATE NOCASE
  `).all();
  res.json(rows);
});

// ---------- Работы ----------
app.get('/api/works', (req, res) => {
  if (req.user.role === 'student') {
    const childId = Number(req.user.childId);
    const classId = Number(req.user.classId);
    if (!Number.isFinite(childId) || !Number.isFinite(classId)) {
      return res.status(401).json({ error: 'Нужно войти заново' });
    }
    const rows = db.prepare(`
      SELECT w.*,
        (SELECT COUNT(*) FROM submissions s WHERE s.work_id=w.id AND s.child_id=?) AS mine_done
      FROM works w
      JOIN work_classes wc ON wc.work_id=w.id AND wc.class_id=?
      ORDER BY w.date DESC, w.id DESC
    `).all(childId, classId);
    return res.json(rows.map((w) => ({
      ...w,
      done: !!w.mine_done,
      mine_done: undefined,
    })));
  }
  const rows = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(DISTINCT variant) FROM keys k WHERE k.work_id=w.id) AS keyed_variants,
      (SELECT COUNT(*) FROM submissions s WHERE s.work_id=w.id) AS submissions,
      (SELECT GROUP_CONCAT(cl.name, ', ') FROM work_classes wc
         JOIN classes cl ON cl.id=wc.class_id WHERE wc.work_id=w.id) AS class_names
    FROM works w
    ORDER BY w.date DESC, w.id DESC
  `).all();
  res.json(rows);
});

app.post('/api/works', teacherOnly, (req, res) => {
  const title = clean(req.body?.title);
  const date = validDate(req.body?.date) ? req.body.date : '';
  const taskCount = parseInt(req.body?.task_count, 10);
  const variantCount = parseInt(req.body?.variant_count ?? 2, 10);
  let classIds = req.body?.class_ids;
  if (!Array.isArray(classIds)) classIds = req.body?.class_id != null ? [req.body.class_id] : [];
  classIds = [...new Set(classIds.map((x) => parseInt(x, 10)).filter((n) => Number.isFinite(n)))];
  if (!title) return res.status(400).json({ error: 'Введите название' });
  if (!date) return res.status(400).json({ error: 'Укажите дату' });
  if (!Number.isFinite(taskCount) || taskCount < 1 || taskCount > 50) {
    return res.status(400).json({ error: 'Число заданий: 1–50' });
  }
  if (!Number.isFinite(variantCount) || variantCount < 1 || variantCount > 10) {
    return res.status(400).json({ error: 'Число вариантов: 1–10' });
  }
  if (!classIds.length) return res.status(400).json({ error: 'Выберите класс' });
  for (const id of classIds) {
    if (!db.prepare('SELECT id FROM classes WHERE id=?').get(id)) {
      return res.status(400).json({ error: 'Класс не найден' });
    }
  }
  let workId;
  withTx(() => {
    const r = db.prepare(
      'INSERT INTO works(title,date,task_count,variant_count,created_by) VALUES(?,?,?,?,?)'
    ).run(title, date, taskCount, variantCount, req.user.name);
    workId = Number(r.lastInsertRowid);
    const ins = db.prepare('INSERT INTO work_classes(work_id,class_id) VALUES(?,?)');
    for (const id of classIds) ins.run(workId, id);
  });
  res.json({ id: workId });
});

app.put('/api/works/:id/classes', teacherOnly, (req, res) => {
  const work = getWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });
  const rawClassIds = req.body?.class_ids;
  if (!Array.isArray(rawClassIds)) return res.status(400).json({ error: 'Укажите классы' });
  const parsedIds = rawClassIds.map(Number);
  if (parsedIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    return res.status(400).json({ error: 'Неверный класс' });
  }
  const classIds = [...new Set(parsedIds)];
  for (const id of classIds) {
    if (!db.prepare('SELECT id FROM classes WHERE id=?').get(id)) {
      return res.status(400).json({ error: 'Класс не найден' });
    }
  }
  const previousIds = new Set(workClasses(work.id).map((c) => c.id));
  const nextIds = new Set(classIds);
  withTx(() => {
    const del = db.prepare('DELETE FROM work_classes WHERE work_id=? AND class_id=?');
    const ins = db.prepare('INSERT INTO work_classes(work_id,class_id) VALUES(?,?)');
    for (const id of previousIds) if (!nextIds.has(id)) del.run(work.id, id);
    for (const id of nextIds) if (!previousIds.has(id)) ins.run(work.id, id);
  });
  res.json({ ok: true });
});

app.delete('/api/works/:id', teacherOnly, (req, res) => {
  const r = db.prepare('DELETE FROM works WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Не найдена' });
  res.json({ ok: true });
});

app.get('/api/works/:id', (req, res) => {
  const work = getWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });
  if (req.user.role === 'student') {
    const ok = db.prepare(
      'SELECT 1 FROM work_classes WHERE work_id=? AND class_id=?'
    ).get(work.id, req.user.classId);
    if (!ok) return res.status(403).json({ error: 'Нет доступа' });
  }
  const out = { work, classes: workClasses(work.id) };
  if (req.user.role === 'teacher') {
    const keyRows = db.prepare(
      'SELECT variant, task_no, answer FROM keys WHERE work_id=? ORDER BY variant, task_no'
    ).all(work.id);
    const keys = {};
    for (const row of keyRows) {
      if (!keys[row.variant]) keys[row.variant] = {};
      keys[row.variant][row.task_no] = row.answer;
    }
    out.keys = keys;
  }
  res.json(out);
});

app.put('/api/works/:id/keys', teacherOnly, (req, res) => {
  const work = getWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });
  const variant = parseInt(req.body?.variant, 10);
  const answers = req.body?.answers;
  if (!Number.isFinite(variant) || variant < 1 || variant > work.variant_count) {
    return res.status(400).json({ error: 'Неверный вариант' });
  }
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Нет ответов' });
  }
  const upsert = db.prepare(`
    INSERT INTO keys(work_id,variant,task_no,answer) VALUES(?,?,?,?)
    ON CONFLICT(work_id,variant,task_no) DO UPDATE SET answer=excluded.answer
  `);
  const del = db.prepare('DELETE FROM keys WHERE work_id=? AND variant=? AND task_no=?');
  withTx(() => {
    for (let n = 1; n <= work.task_count; n++) {
      const raw = answers[n] ?? answers[String(n)];
      const a = clean(raw);
      if (!a) del.run(work.id, variant, n);
      else upsert.run(work.id, variant, n, a);
    }
  });
  res.json({ ok: true });
});

app.get('/api/works/:id/mine', (req, res) => {
  const work = getWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });
  let childId = parseInt(req.query.child_id, 10);
  if (req.user.role === 'student') childId = req.user.childId;
  if (!childId) return res.status(400).json({ error: 'Укажите ребёнка' });
  if (req.user.role === 'student') {
    const ok = db.prepare(
      'SELECT 1 FROM work_classes WHERE work_id=? AND class_id=?'
    ).get(work.id, req.user.classId);
    if (!ok) return res.status(403).json({ error: 'Нет доступа' });
  }
  const sub = db.prepare(
    'SELECT * FROM submissions WHERE work_id=? AND child_id=?'
  ).get(work.id, childId);
  if (!sub) return res.json({ work, submission: null, answers: {} });
  const rows = db.prepare(
    'SELECT task_no, answer FROM answers WHERE submission_id=?'
  ).all(sub.id);
  const answers = {};
  for (const r of rows) answers[r.task_no] = r.answer;
  res.json({ work, submission: sub, answers });
});

app.put('/api/works/:id/submit', (req, res) => {
  const work = getWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });
  let childId = parseInt(req.body?.child_id, 10);
  if (req.user.role === 'student') childId = req.user.childId;
  const variant = parseInt(req.body?.variant, 10);
  const answers = req.body?.answers;
  const child = db.prepare('SELECT id, name, class_id FROM children WHERE id=?').get(childId);
  if (!child) return res.status(400).json({ error: 'Ребёнок не найден' });
  if (req.user.role === 'student') {
    const ok = db.prepare(
      'SELECT 1 FROM work_classes WHERE work_id=? AND class_id=?'
    ).get(work.id, child.class_id);
    if (!ok) return res.status(403).json({ error: 'Нет доступа' });
  }
  if (!Number.isFinite(variant) || variant < 1 || variant > work.variant_count) {
    return res.status(400).json({ error: 'Неверный вариант' });
  }
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Нет ответов' });
  }
  if (req.user.role !== 'teacher' && req.user.role !== 'student') {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const existing = db.prepare(
    'SELECT id, submitted_at FROM submissions WHERE work_id=? AND child_id=?'
  ).get(work.id, childId);
  if (existing?.submitted_at && req.user.role === 'student') {
    return res.status(409).json({ error: 'Работа уже сдана, менять ответы нельзя' });
  }
  const now = new Date().toISOString();
  let subId;
  withTx(() => {
    if (existing) {
      subId = existing.id;
      db.prepare(
        'UPDATE submissions SET variant=?, submitted_at=? WHERE id=?'
      ).run(variant, now, subId);
      db.prepare('DELETE FROM answers WHERE submission_id=?').run(subId);
    } else {
      const r = db.prepare(
        'INSERT INTO submissions(work_id,child_id,variant,submitted_at) VALUES(?,?,?,?)'
      ).run(work.id, childId, variant, now);
      subId = Number(r.lastInsertRowid);
    }
    const ins = db.prepare(
      'INSERT INTO answers(submission_id,task_no,answer) VALUES(?,?,?)'
    );
    for (let n = 1; n <= work.task_count; n++) {
      const a = clean(answers[n] ?? answers[String(n)]);
      if (a) ins.run(subId, n, a);
    }
  });
  res.json({ ok: true, submission_id: subId });
});

app.get('/api/works/:id/matrix', teacherOnly, (req, res) => {
  const work = getWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });

  const classes = workClasses(work.id);
  const requestedClassId = req.query.class_id == null ? null : Number(req.query.class_id);
  const selectedClassId = requestedClassId ?? classes[0]?.id ?? null;
  if (requestedClassId !== null &&
      (!Number.isSafeInteger(requestedClassId) || !classes.some((c) => c.id === requestedClassId))) {
    return res.status(400).json({ error: 'Класс не назначен этой работе' });
  }
  const children = selectedClassId == null ? [] : db.prepare(`
    SELECT id, name FROM children WHERE class_id=? ORDER BY name COLLATE NOCASE
  `).all(selectedClassId);

  const keyRows = db.prepare(
    'SELECT variant, task_no, answer FROM keys WHERE work_id=?'
  ).all(work.id);
  const keys = {};
  for (const row of keyRows) {
    if (!keys[row.variant]) keys[row.variant] = {};
    keys[row.variant][row.task_no] = row.answer;
  }

  const subs = db.prepare(
    'SELECT id, child_id, variant FROM submissions WHERE work_id=? AND submitted_at IS NOT NULL'
  ).all(work.id);
  const subByChild = Object.fromEntries(subs.map((s) => [s.child_id, s]));
  const ansBySub = {};
  for (const s of subs) {
    const rows = db.prepare(
      'SELECT task_no, answer FROM answers WHERE submission_id=?'
    ).all(s.id);
    const map = {};
    for (const r of rows) map[r.task_no] = r.answer;
    ansBySub[s.id] = map;
  }

  const columns = children.map((ch) => {
    const sub = subByChild[ch.id];
    if (!sub) {
      return { child_id: ch.id, name: ch.name, variant: null, submitted: false, cells: null };
    }
    const ans = ansBySub[sub.id] || {};
    const key = keys[sub.variant] || {};
    const cells = [];
    for (let n = 1; n <= work.task_count; n++) {
      const studentA = ans[n];
      if (studentA == null || studentA === '') {
        cells.push({ task_no: n, status: 'missed', student: null, key: key[n] ?? null });
        continue;
      }
      const keyA = key[n];
      if (keyA == null || keyA === '') {
        // без ключа не красим — нейтрально
        cells.push({ task_no: n, status: 'unchecked', student: studentA, key: null });
        continue;
      }
      const ok = normAnswer(studentA) === normAnswer(keyA);
      cells.push({
        task_no: n,
        status: ok ? 'match' : 'mismatch',
        student: studentA,
        key: keyA,
      });
    }
    return { child_id: ch.id, name: ch.name, variant: sub.variant, submitted: true, cells };
  });

  res.json({ work, classes, selected_class_id: selectedClassId, columns });
});

const INDEX_HTML = fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8');
function loadPwaProfile(manifestFile, icon192, appleIcon) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(__dirname, 'public', manifestFile), 'utf8')
  );
  return {
    theme: manifest.theme_color,
    name: manifest.name,
    shortName: manifest.short_name,
    title: manifest.name,
    manifest: '/' + manifestFile,
    icon192,
    appleIcon,
  };
}

const PWA_PROFILES = {
  default: loadPwaProfile(
    'manifest.webmanifest',
    '/icons/app-192.png',
    '/icons/app-180.png'
  ),
  teacher: loadPwaProfile(
    'manifest-teacher.webmanifest',
    '/icons/teacher-192.png',
    '/icons/teacher-180.png'
  ),
  student: loadPwaProfile(
    'manifest-student.webmanifest',
    '/icons/student-192.png',
    '/icons/student-180.png'
  ),
};

function pwaProfile(req) {
  const portal = portalFromPath(req.path);
  return PWA_PROFILES[portal] || PWA_PROFILES.default;
}

function renderIndex(req) {
  const p = pwaProfile(req);
  return INDEX_HTML
    .replaceAll('__THEME_COLOR__', p.theme)
    .replaceAll('__APP_NAME__', p.name)
    .replaceAll('__APP_SHORT_NAME__', p.shortName)
    .replaceAll('__PAGE_TITLE__', p.title)
    .replaceAll('__MANIFEST_HREF__', p.manifest)
    .replaceAll('__ICON_192__', p.icon192)
    .replaceAll('__APPLE_ICON__', p.appleIcon);
}

app.get(
  ['/manifest.webmanifest', '/manifest-teacher.webmanifest', '/manifest-student.webmanifest'],
  (req, res) => {
    res.type('application/manifest+json').set('Cache-Control', 'no-cache');
    res.sendFile(path.join(__dirname, 'public', path.basename(req.path)));
  }
);

app.get('/sw.js', (req, res) => {
  res.type('application/javascript').set('Cache-Control', 'no-cache');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

app.get('/', (req, res) => {
  res.set('Cache-Control', 'no-cache').type('html').send(renderIndex(req));
});

app.get('/index.html', (req, res) => {
  res.redirect(308, '/');
});

app.use(express.static(path.join(__dirname, 'public'), { index: false }));
app.get('*', (req, res) => {
  res.set('Cache-Control', 'no-cache').type('html').send(renderIndex(req));
});

app.listen(PORT, () => console.log(`homework-check http://localhost:${PORT}`));
