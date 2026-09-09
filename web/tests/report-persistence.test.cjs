const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const code = ts.transpileModule(fs.readFileSync(require('node:path').join(__dirname, '../components/railway-dashboard/bridge.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 } }).outputText;
function setup() {
  const data = new Map();
  const storage = { getItem: k => data.get(k) ?? null, setItem: (k, v) => data.set(k, v) };
  const context = { exports: {}, localStorage: storage, crypto: require('node:crypto').webcrypto };
  vm.runInNewContext(code, context);
  return { b: context.exports, storage };
}
const args = { id: 'INS-test', createdAt: '2026-09-09T00:00:00Z', incidents: [], ai: null, mode: 'image', frames: 1, durationSec: 0, hero: null, geo: null, operator: 'test' };
test('a clean scan is filed and later AI updates replace the same report', () => {
  const { b } = setup();
  b.saveInspection(b.buildInspection(args));
  b.saveInspection(b.buildInspection({ ...args, ai: { verdict: 'healthy' } }));
  assert.equal(b.readInspections().length, 1);
  assert.equal(b.readInspections()[0].ai.verdict, 'healthy');
  assert.equal(b.readInspections()[0].createdAt, args.createdAt);
});
test('storage failures propagate to callers instead of reporting success', () => {
  const { b, storage } = setup();
  storage.setItem = () => { throw new Error('QuotaExceededError'); };
  assert.throws(() => b.saveInspection(b.buildInspection(args)), /QuotaExceeded/);
  assert.throws(() => b.writeDetections([]), /QuotaExceeded/);
});
test('findings link to their scan, do not collide by timestamp, and retain reviews on resave', () => {
  const { b } = setup();
  const incident = { id: 1, ts: 1000, cls: 0, conf: .9, sev: 'High', thumb: '', region: '', areaFrac: .1, persist: 1, action: '', geo: { lat: 1, lon: 2, acc: 0 } };
  const rec = b.buildInspection({ ...args, incidents: [incident] });
  const detection = b.incidentToDetection(incident, rec.id);
  assert.equal(detection.id, rec.findings[0].id);
  assert.equal(detection.inspectionId, rec.id);
  b.appendDetections([detection, b.incidentToDetection({ ...incident, id: 2 }, rec.id)]);
  assert.equal(b.readDetections().length, 2);
  b.writeDetections([{ ...detection, status: 'resolved', note: 'Repaired' }]);
  b.appendDetections([detection]);
  assert.equal(b.readDetections()[0].status, 'resolved');
  assert.equal(b.readDetections()[0].note, 'Repaired');
});
