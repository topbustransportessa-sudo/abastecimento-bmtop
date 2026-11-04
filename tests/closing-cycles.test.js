const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");

process.env.TZ = "America/Sao_Paulo";

function appContext() {
  const source = fs.readFileSync(path.join(__dirname, "../public/app.js"), "utf8").split("\ninit();")[0];
  const context = vm.createContext({
    document: { querySelector: () => null },
    localStorage: { getItem: () => null },
    console,
  });
  vm.runInContext(source, context);
  return context;
}

test("an after-hours opening gets its own audit group and fuel total", () => {
  const context = appContext();
  const at = (hour, minute) => `2026-11-${hour < 7 ? "04" : "03"}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`;
  const closing = (pump, kind, value, date) => ({
    id: `${pump}-${kind}-${date}`,
    pump,
    initial: kind === "initial" ? value : 0,
    final: kind === "final" ? value : 0,
    createdAt: date,
  });
  context.closings = [
    closing("1", "initial", 1000, at(17, 0)),
    closing("5", "initial", 2000, at(17, 1)),
    closing("6", "initial", 3000, at(17, 2)),
    closing("1", "final", 1100, at(2, 0)),
    closing("5", "final", 2050, at(2, 1)),
    closing("6", "final", 3050, at(2, 2)),
    closing("1", "initial", 1100, at(3, 30)),
    closing("1", "final", 1120, at(4, 0)),
  ];
  context.fuelings = [{ id: "mechanic-fueling", pump: "1", liters: 20, createdAt: at(3, 45) }];
  vm.runInContext("state.pumpClosings = closings; state.fuelings = fuelings", context);
  const groups = vm.runInContext("topbusClosingGroups()", context);
  assert.equal(groups.length, 2);
  assert.equal(groups[0].extra, true);
  assert.equal(groups[0].cycles.length, 1);
  assert.equal(groups[0].measured, 20);
  assert.equal(groups[0].launched, 20);
  context.extraGroup = groups[0];
  assert.equal(vm.runInContext("auditCycleMetrics(extraGroup).status", context), "ok");
  assert.equal(groups[1].extra, false);
  assert.equal(groups[1].cycles.length, 3);
  assert.equal(groups[1].launched, 0);
});

test("a mechanic opening before the regular shift stays separate", () => {
  const context = appContext();
  const closing = (id, pump, kind, value, createdAt) => ({
    id, pump, createdAt,
    initial: kind === "initial" ? value : 0,
    final: kind === "final" ? value : 0,
  });
  context.closings = [
    closing("m-initial", "1", "initial", 1100, "2026-11-03T10:00:00-03:00"),
    closing("m-final", "1", "final", 1120, "2026-11-03T10:30:00-03:00"),
    closing("n1-initial", "1", "initial", 1120, "2026-11-03T17:00:00-03:00"),
    closing("n5-initial", "5", "initial", 2000, "2026-11-03T17:01:00-03:00"),
    closing("n6-initial", "6", "initial", 3000, "2026-11-03T17:02:00-03:00"),
    closing("n1-final", "1", "final", 1200, "2026-11-04T02:00:00-03:00"),
    closing("n5-final", "5", "final", 2050, "2026-11-04T02:01:00-03:00"),
    closing("n6-final", "6", "final", 3050, "2026-11-04T02:02:00-03:00"),
  ];
  context.fuelings = [{ id: "mechanic-fueling", pump: "1", liters: 20, createdAt: "2026-11-03T10:15:00-03:00" }];
  vm.runInContext("state.pumpClosings = closings; state.fuelings = fuelings", context);
  const groups = vm.runInContext("topbusClosingGroups()", context);
  assert.equal(groups.length, 2);
  const mechanic = groups.find((group) => group.extra);
  assert.equal(mechanic.cycles.length, 1);
  assert.equal(mechanic.launched, 20);
  assert.equal(groups.find((group) => !group.extra).cycles.length, 3);
});

test("closing after a prior final requires a new initial instead of replacing it", async () => {
  process.env.SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-key";
  process.env.SESSION_SECRET = "closing-test-secret";
  const api = require("../api/[...path].js");
  const body = Buffer.from(JSON.stringify({ pump: "1", kind: "final", value: 30740, photo: "photo" }));
  const payload = Buffer.from(JSON.stringify({ id: "user-1", exp: Date.now() + 60000 })).toString("base64url");
  const signature = crypto.createHmac("sha256", process.env.SESSION_SECRET).update(payload).digest("base64url");
  const originalFetch = global.fetch;
  global.fetch = async (url) => ({
    ok: true,
    text: async () => JSON.stringify(url.includes("app_users?")
      ? [{ id: "user-1", active: true, role: "frentista" }]
      : url.includes("created_at=gte.") ? []
      : [{ id: "old-final", initial: 0, final: 2976, created_at: "2026-11-04T03:07:00-03:00" }]),
  });
  const res = {
    status(code) { this.statusCode = code; return this; },
    setHeader() { return this; },
    end(value) { this.body = JSON.parse(value); },
  };
  const req = {
    method: "POST",
    query: { path: ["closings"] },
    headers: { authorization: `Bearer ${payload}.${signature}` },
    async *[Symbol.asyncIterator]() { yield body; },
  };
  try {
    await api(req, res);
    assert.equal(res.statusCode, 409);
    assert.match(res.body.error, /encerrante inicial/);
  } finally {
    global.fetch = originalFetch;
  }
});
