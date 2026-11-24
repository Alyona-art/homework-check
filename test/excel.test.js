const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const appSource = fs.readFileSync(path.join(__dirname, '..', 'public', 'app.js'), 'utf8');
const exporterSource = appSource.slice(
  appSource.indexOf('function matrixTotals('),
  appSource.indexOf('async function renderMatrix()')
);

async function exportSheets(all, classNames = ['5А', '5Б']) {
  let blob;
  const anchor = { click() {} };
  const context = {
    TextEncoder, Uint8Array, DataView, Blob,
    URL: { createObjectURL(value) { blob = value; return 'blob:verify'; }, revokeObjectURL() {} },
    document: { createElement() { return anchor; } },
    w: { title: 'Проверка', date: '2026-11-23', task_count: 2 },
    results: [
      { className: classNames[0], columns: [{ name: 'Иванова', variant: 1,
        cells: [{ student: 'да', status: 'match' }, { student: '7', status: 'match' }] }] },
      { className: classNames[1], columns: [{ name: 'Петров', variant: 1,
        cells: [{ student: 'нет', status: 'mismatch' }, { student: '7', status: 'match' }] }] },
    ],
  };
  vm.runInNewContext(exporterSource +
    `\ndownloadMatrixExcel(w, ${all ? 'results' : '[results[0]]'}, ${all});`, context);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const decoder = new TextDecoder();
  const files = new Map();
  for (let p = 0; view.getUint32(p, true) === 0x04034b50;) {
    const size = view.getUint32(p + 18, true);
    const nameLength = view.getUint16(p + 26, true);
    const extraLength = view.getUint16(p + 28, true);
    const name = decoder.decode(bytes.subarray(p + 30, p + 30 + nameLength));
    const start = p + 30 + nameLength + extraLength;
    files.set(name, decoder.decode(bytes.subarray(start, start + size)));
    p = start + size;
  }
  return { files, filename: anchor.download };
}

test('active class export has one sheet and task totals', async () => {
  const { files, filename } = await exportSheets(false);
  assert.equal(files.has('xl/worksheets/sheet2.xml'), false);
  assert.match(filename, /5А\.xlsx$/);
  const sheet = files.get('xl/worksheets/sheet1.xml');
  assert.match(sheet, /Иванова/);
  assert.doesNotMatch(sheet, /Петров/);
  assert.match(sheet, /Итого верно/);
  assert.match(sheet, /<c r="B3" s="1"><v>1<\/v><\/c>/);
  assert.match(sheet, /<c r="C3" s="1"><v>1<\/v><\/c>/);
});

test('all-class export has isolated sheets named for their classes', async () => {
  const { files, filename } = await exportSheets(true);
  assert.match(filename, /все_классы\.xlsx$/);
  const workbook = files.get('xl/workbook.xml');
  assert.match(workbook, /<sheet name="5А" sheetId="1"/);
  assert.match(workbook, /<sheet name="5Б" sheetId="2"/);
  assert.match(files.get('xl/_rels/workbook.xml.rels'), /worksheets\/sheet2\.xml/);
  assert.match(files.get('xl/worksheets/sheet1.xml'), /Иванова/);
  assert.doesNotMatch(files.get('xl/worksheets/sheet1.xml'), /Петров/);
  assert.match(files.get('xl/worksheets/sheet2.xml'), /Петров/);
  assert.doesNotMatch(files.get('xl/worksheets/sheet2.xml'), /Иванова/);
  assert.match(files.get('xl/worksheets/sheet2.xml'), /Итого верно/);
});

test('Excel sheet names are valid and unique after cleaning and truncation', async () => {
  const longName = "'Очень длинный класс [A]/: с лишними символами'";
  const { files } = await exportSheets(true, [longName, longName]);
  const names = [...files.get('xl/workbook.xml').matchAll(/<sheet name="([^"]+)"/g)]
    .map((match) => match[1]);
  assert.equal(names.length, 2);
  assert.notEqual(names[0].toLowerCase(), names[1].toLowerCase());
  for (const name of names) {
    assert.ok(name.length <= 31);
    assert.doesNotMatch(name, /[\[\]:*?/\\]/);
    assert.doesNotMatch(name, /^'|'$/);
  }
});
