const express = require('express');
const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const { TEACHER_CODE, STUDENT_CODE, SECRET } = process.env;
if (!TEACHER_CODE || !STUDENT_CODE || !SECRET) {
  console.error('Задайте TEACHER_CODE, STUDENT_CODE, SECRET (см. .env.example)');
  process.exit(1);
}
const PORT = process.env.PORT || 3001;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'homework.db'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');
db.exec(`
CREATE TABLE IF NOT EXISTS children(
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE NOT NULL COLLATE NOCASE,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE IF NOT EXISTS works(
  id INTEGER PRIMARY KEY,
  title TEXT NOT NULL,
  date TEXT NOT NULL,
  task_count INTEGER NOT NULL CHECK(task_count >= 1 AND task_count <= 50),
  variant_count INTEGER NOT NULL DEFAULT 2 CHECK(variant_count >= 1 AND variant_count <= 10),
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP);
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
/** Нормализация для сравнения ответов */
function normAnswer(s) {
  return String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/,/g, '.')
    .replace(/[ё]/g, 'е');
}

const fails = new Map();
const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

app.post('/api/login', (req, res) => {
  const ip = req.ip;
  const f = fails.get(ip);
  if (f && f.n >= 10 && f.until > Date.now()) {
    return res.status(429).json({ error: 'Слишком много попыток, подождите 10 минут' });
  }
  const { role, secret } = req.body || {};
  const name = clean(req.body?.name);
  let ok = false;
  let who = name;
  if (role === 'teacher') {
    ok = name && safeEq(secret, TEACHER_CODE);
  } else if (role === 'student') {
    ok = safeEq(secret, STUDENT_CODE);
    who = 'Ученик';
  }
  if (!ok) {
    fails.set(ip, { n: (f?.n || 0) + 1, until: Date.now() + 10 * 60e3 });
    const err = role === 'teacher'
      ? (!name ? 'Введите ФИО' : 'НЕВЕРНЫЙ КОД')
      : 'НЕВЕРНЫЙ КОД';
    return res.status(401).json({ error: err });
  }
  fails.delete(ip);
  res.json({ token: makeToken({ role, name: who }), role, name: who });
});

app.use('/api', (req, res, next) => {
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

// ---------- Дети ----------
app.get('/api/children', (req, res) => {
  const rows = db.prepare('SELECT id, name FROM children ORDER BY name COLLATE NOCASE').all();
  res.json(rows);
});

app.post('/api/children', teacherOnly, (req, res) => {
  const name = titleCase(req.body?.name);
  if (!name) return res.status(400).json({ error: 'Введите фамилию' });
  try {
    const r = db.prepare('INSERT INTO children(name) VALUES(?)').run(name);
    res.json({ id: Number(r.lastInsertRowid), name });
  } catch {
    res.status(409).json({ error: 'Такая фамилия уже есть' });
  }
});

app.delete('/api/children/:id', teacherOnly, (req, res) => {
  const r = db.prepare('DELETE FROM children WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Не найден' });
  res.json({ ok: true });
});

// ---------- Работы ----------
app.get('/api/works', (req, res) => {
  const rows = db.prepare(`
    SELECT w.*,
      (SELECT COUNT(DISTINCT variant) FROM keys k WHERE k.work_id=w.id) AS keyed_variants,
      (SELECT COUNT(*) FROM submissions s WHERE s.work_id=w.id) AS submissions
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
  if (!title) return res.status(400).json({ error: 'Введите название' });
  if (!date) return res.status(400).json({ error: 'Укажите дату' });
  if (!Number.isFinite(taskCount) || taskCount < 1 || taskCount > 50) {
    return res.status(400).json({ error: 'Число заданий: 1–50' });
  }
  if (!Number.isFinite(variantCount) || variantCount < 1 || variantCount > 10) {
    return res.status(400).json({ error: 'Число вариантов: 1–10' });
  }
  const r = db.prepare(
    'INSERT INTO works(title,date,task_count,variant_count,created_by) VALUES(?,?,?,?,?)'
  ).run(title, date, taskCount, variantCount, req.user.name);
  res.json({ id: Number(r.lastInsertRowid) });
});

app.delete('/api/works/:id', teacherOnly, (req, res) => {
  const r = db.prepare('DELETE FROM works WHERE id=?').run(req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Не найдена' });
  res.json({ ok: true });
});

app.get('/api/works/:id', (req, res) => {
  const work = getWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });
  const out = { work };
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

// ---------- Ключ (учитель) ----------
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

// ---------- Сдача ученика ----------
app.get('/api/works/:id/mine', (req, res) => {
  const work = getWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });
  const childId = parseInt(req.query.child_id, 10);
  if (!childId) return res.status(400).json({ error: 'Укажите ребёнка' });
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
  const childId = parseInt(req.body?.child_id, 10);
  const variant = parseInt(req.body?.variant, 10);
  const answers = req.body?.answers;
  const child = db.prepare('SELECT id, name FROM children WHERE id=?').get(childId);
  if (!child) return res.status(400).json({ error: 'Ребёнок не найден' });
  if (!Number.isFinite(variant) || variant < 1 || variant > work.variant_count) {
    return res.status(400).json({ error: 'Неверный вариант' });
  }
  if (!answers || typeof answers !== 'object') {
    return res.status(400).json({ error: 'Нет ответов' });
  }
  // ученик может сдавать только за себя через student-роль; учитель — за любого
  if (req.user.role !== 'teacher' && req.user.role !== 'student') {
    return res.status(403).json({ error: 'Нет доступа' });
  }
  const now = new Date().toISOString();
  let subId;
  withTx(() => {
    const existing = db.prepare(
      'SELECT id FROM submissions WHERE work_id=? AND child_id=?'
    ).get(work.id, childId);
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

// ---------- Матрица сравнения ----------
app.get('/api/works/:id/matrix', teacherOnly, (req, res) => {
  const work = getWork(req.params.id);
  if (!work) return res.status(404).json({ error: 'Работа не найдена' });

  const children = db.prepare('SELECT id, name FROM children ORDER BY name COLLATE NOCASE').all();
  const keyRows = db.prepare(
    'SELECT variant, task_no, answer FROM keys WHERE work_id=?'
  ).all(work.id);
  const keys = {};
  for (const row of keyRows) {
    if (!keys[row.variant]) keys[row.variant] = {};
    keys[row.variant][row.task_no] = row.answer;
  }

  const subs = db.prepare(
    'SELECT id, child_id, variant FROM submissions WHERE work_id=?'
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
      return { child_id: ch.id, name: ch.name, variant: null, cells: null };
    }
    const ans = ansBySub[sub.id] || {};
    const key = keys[sub.variant] || {};
    const cells = [];
    for (let n = 1; n <= work.task_count; n++) {
      const studentA = ans[n];
      if (studentA == null || studentA === '') {
        cells.push({ task_no: n, status: 'missing', student: null, key: key[n] ?? null });
        continue;
      }
      const keyA = key[n];
      if (keyA == null || keyA === '') {
        cells.push({ task_no: n, status: 'no_key', student: studentA, key: null });
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
    return { child_id: ch.id, name: ch.name, variant: sub.variant, cells };
  });

  res.json({ work, columns });
});

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => console.log(`homework-check http://localhost:${PORT}`));
