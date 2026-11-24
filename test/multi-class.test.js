const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { spawn } = require('node:child_process');
const { DatabaseSync } = require('node:sqlite');

const root = path.join(__dirname, '..');

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

test('shared work assignments, submissions, results, and restart', async () => {
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(root, 'data', 'verify-'));
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let server;
  async function start() {
    server = spawn(process.execPath, ['server.js'], {
      cwd: root,
      env: { ...process.env, DATA_DIR: dataDir, PORT: String(port),
        TEACHER_CODE: 'verify-code', SECRET: 'verify-secret', OPENSSL_CONF: '/dev/null' },
      stdio: 'ignore',
    });
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error(`server exited: ${server.exitCode}`);
      try { await fetch(base + '/api/portal'); return; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error('server did not start');
  }
  async function stop() {
    if (!server || server.exitCode !== null) return;
    const child = server;
    child.kill();
    await new Promise((resolve) => child.once('exit', resolve));
  }
  async function api(method, url, token, body, status = 200) {
    const response = await fetch(base + '/api' + url, {
      method,
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${url}: ${JSON.stringify(result)}`);
    return result;
  }
  try {
    await start();
    const teacher = (await api('POST', '/login', null,
      { role: 'teacher', name: 'Учитель', secret: 'verify-code' })).token;
    const a = (await api('POST', '/classes', teacher, { name: '5А' })).id;
    const b = (await api('POST', '/classes', teacher, { name: '5Б' })).id;
    const c = (await api('POST', '/classes', teacher, { name: '5В' })).id;
    const alice = (await api('POST', `/classes/${a}/children`, teacher, { name: 'Иванова' })).id;
    const bob = (await api('POST', `/classes/${b}/children`, teacher, { name: 'Петров' })).id;
    const carol = (await api('POST', `/classes/${c}/children`, teacher, { name: 'Сидорова' })).id;
    const student = async (id) => (await api('POST', '/login', null,
      { role: 'student', child_id: id })).token;
    const aliceToken = await student(alice);
    const bobToken = await student(bob);
    const carolToken = await student(carol);

    const single = (await api('POST', '/works', teacher,
      { title: 'Один класс', date: '2026-11-23', task_count: 2, variant_count: 1, class_ids: [a] })).id;
    assert.deepEqual((await api('GET', `/works/${single}`, teacher)).classes.map((x) => x.id), [a]);
    await api('PUT', `/works/${single}/classes`, teacher, { class_ids: [a, c] });
    assert.deepEqual((await api('GET', `/works/${single}`, teacher)).classes.map((x) => x.id).sort(), [a, c]);
    await api('PUT', `/works/${single}/classes`, teacher, { class_ids: [a] });
    const work = (await api('POST', '/works', teacher,
      { title: 'Общая', date: '2026-11-23', task_count: 2, variant_count: 1, class_ids: [a, b, b] })).id;
    assert.deepEqual((await api('GET', `/works/${work}`, teacher)).classes.map((x) => x.id).sort(), [a, b]);
    assert.equal((await api('GET', '/works', aliceToken)).filter((x) => x.id === work).length, 1);
    assert.equal((await api('GET', '/works', bobToken)).filter((x) => x.id === work).length, 1);
    assert.equal((await api('GET', '/works', carolToken)).some((x) => x.id === work), false);

    await api('PUT', `/works/${work}/keys`, teacher, { variant: 1, answers: { 1: 'да', 2: '7' } });
    await api('PUT', `/works/${work}/submit`, aliceToken,
      { variant: 1, answers: { 1: 'да', 2: '7' } });
    await api('PUT', `/works/${work}/submit`, bobToken,
      { variant: 1, answers: { 1: 'нет', 2: '7' } });
    await api('PUT', `/works/${work}/submit`, aliceToken,
      { variant: 1, answers: { 1: 'нет' } }, 409);
    let matrixA = await api('GET', `/works/${work}/matrix?class_id=${a}`, teacher);
    let matrixB = await api('GET', `/works/${work}/matrix?class_id=${b}`, teacher);
    assert.deepEqual(matrixA.columns.map((x) => x.child_id), [alice]);
    assert.deepEqual(matrixB.columns.map((x) => x.child_id), [bob]);
    assert.deepEqual(matrixA.columns[0].cells.map((x) => x.status), ['match', 'match']);
    assert.deepEqual(matrixB.columns[0].cells.map((x) => x.status), ['mismatch', 'match']);
    await api('PUT', `/works/${work}/keys`, teacher, { variant: 1, answers: { 1: 'нет', 2: '7' } });
    matrixA = await api('GET', `/works/${work}/matrix?class_id=${a}`, teacher);
    matrixB = await api('GET', `/works/${work}/matrix?class_id=${b}`, teacher);
    assert.equal(matrixA.columns[0].cells[0].status, 'mismatch');
    assert.equal(matrixB.columns[0].cells[0].status, 'match');

    await api('PUT', `/works/${work}/classes`, teacher, { class_ids: [a, b, c] });
    assert.equal((await api('GET', '/works', carolToken)).some((x) => x.id === work), true);
    await api('PUT', `/works/${work}/classes`, teacher, { class_ids: [a, c] });
    assert.equal((await api('GET', '/works', bobToken)).some((x) => x.id === work), false);
    await api('GET', `/works/${work}/matrix?class_id=${b}`, teacher, undefined, 400);
    await api('PUT', `/works/${work}/classes`, teacher, { class_ids: [a, b] });
    assert.equal((await api('GET', `/works/${work}/matrix?class_id=${b}`, teacher)).columns[0].cells[0].status, 'match');
    await api('PUT', `/works/${work}/classes`, teacher, { class_ids: [] });
    assert.equal((await api('GET', '/works', aliceToken)).some((x) => x.id === work), false);
    await api('GET', `/works/${work}`, aliceToken, undefined, 403);
    await api('PUT', `/works/${work}/submit`, aliceToken,
      { variant: 1, answers: { 1: 'нет' } }, 403);
    assert.equal((await api('GET', `/works/${work}/matrix`, teacher)).columns.length, 0);
    await stop();

    const db = new DatabaseSync(path.join(dataDir, 'homework.db'));
    try {
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM works WHERE id=?').get(work).n, 1);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM work_classes WHERE work_id=?').get(work).n, 0);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM submissions WHERE work_id=?').get(work).n, 2);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM answers WHERE submission_id IN (SELECT id FROM submissions WHERE work_id=?)').get(work).n, 4);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM keys WHERE work_id=?').get(work).n, 2);
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM work_classes WHERE work_id=?').get(single).n, 1);
      assert.ok(db.prepare("PRAGMA index_list('work_classes')").all().some((x) => x.origin === 'pk' && x.unique === 1));
      assert.throws(() => db.prepare('INSERT INTO work_classes(work_id,class_id) VALUES(?,?)').run(single, a));
    } finally { db.close(); }
    await start();
    assert.equal((await api('GET', `/works/${work}`, teacher)).classes.length, 0);
    assert.equal((await api('GET', '/works', aliceToken)).some((x) => x.id === work), false);
    assert.deepEqual((await api('GET', `/works/${single}`, teacher)).classes.map((x) => x.id), [a]);
  } finally {
    await stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
