const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SESSION_SECRET = process.env.SESSION_SECRET || "dev-only-change-me";

function send(res, status, payload) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function ensureSupabaseEnv() {
  const missing = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"].filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error(`Variaveis ausentes: ${missing.join(", ")}`);
    error.status = 500;
    throw error;
  }
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.pbkdf2Sync(password, salt, 120000, 32, "sha256").toString("hex");
  return { salt, hash };
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verify(token) {
  if (!token || !token.includes(".")) return null;
  const [body, signature] = token.split(".");
  const expected = crypto.createHmac("sha256", SESSION_SECRET).update(body).digest("base64url");
  if (Buffer.byteLength(signature || "") !== Buffer.byteLength(expected)) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (payload.exp < Date.now()) return null;
  return payload;
}

async function supabase(path, options = {}) {
  ensureSupabaseEnv();
  const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SUPABASE_KEY,
      authorization: `Bearer ${SUPABASE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(data?.message || text || "Erro no Supabase");
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

function mapVehicle(row) {
  return {
    id: row.id,
    code: row.code,
    plate: row.plate,
    minAvg: Number(row.min_avg),
    maxAvg: Number(row.max_avg),
    active: row.active,
  };
}

function mapFueling(row) {
  const observation = row.observation || "";
  const offlineFallback = /\[OFFLINE/i.test(observation);
  return {
    id: row.id,
    createdAt: row.created_at,
    vehicleId: row.vehicle_id,
    vehiclePhoto: row.vehicle_photo_url || "",
    tachographPhoto: row.tachograph_photo_url || "",
    pump: row.pump,
    pumpPhoto: row.pump_photo_url || "",
    km: Number(row.km),
    liters: Number(row.liters),
    observation,
    userId: row.user_id,
    source: row.source || (row.offline_created_at || offlineFallback ? "offline" : "online"),
    offlineCreatedAt: row.offline_created_at || null,
    syncedAt: row.synced_at || null,
  };
}

function mapFuelingAudit(row) {
  return {
    id: row.id,
    fuelingId: row.fueling_id,
    changedAt: row.changed_at,
    changedBy: row.changed_by,
    justification: row.justification,
    changes: row.changes || [],
  };
}

function mapClosing(row) {
  return {
    id: row.id,
    date: row.date,
    pump: row.pump,
    initial: Number(row.initial),
    final: Number(row.final),
    photo: row.photo_url || "",
    createdAt: row.created_at,
    userId: row.user_id,
  };
}

function pumpClosingKind(row) {
  if (Number(row.initial || 0) > 0 && Number(row.final || 0) > 0) return "both";
  if (Number(row.final || 0) > 0) return "final";
  return "initial";
}

function mapDieselTank(row) {
  return {
    id: row.id,
    company: row.company,
    name: row.name,
    code: row.code,
    fuelType: row.fuel_type,
    nominalCapacity: Number(row.nominal_capacity || 0),
    realCapacity: Number(row.real_capacity || 0),
    heightMm: Number(row.height_mm || 0),
    diameter: Number(row.diameter || 0),
    active: row.active,
  };
}

function mapDieselArqueacao(row) {
  return {
    id: row.id,
    company: row.company,
    tankId: row.tank_id,
    measureMm: Number(row.measure_mm || 0),
    liters: Number(row.liters || 0),
    active: row.active,
  };
}

function mapDieselTolerance(row) {
  return {
    id: row.id,
    company: row.company,
    tankId: row.tank_id,
    toleranceLiters: Number(row.tolerance_liters || 0),
    tolerancePercent: Number(row.tolerance_percent || 0),
    active: row.active,
  };
}

function mapDieselReceipt(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    company: row.company,
    tankId: row.tank_id,
    receivedAt: row.received_at,
    userId: row.user_id,
    trailerPlate: row.trailer_plate,
    supplier: row.supplier,
    invoiceNumber: row.invoice_number,
    invoiceLiters: Number(row.invoice_liters || 0),
    sealedTruckPhoto: row.sealed_truck_photo_url || "",
    initialMm: Number(row.initial_mm || 0),
    initialLiters: row.initial_liters === null ? null : Number(row.initial_liters || 0),
    initialPhoto: row.initial_photo_url || "",
    finalMm: Number(row.final_mm || 0),
    finalLiters: row.final_liters === null ? null : Number(row.final_liters || 0),
    finalPhoto: row.final_photo_url || "",
    measuredLiters: row.measured_liters === null ? null : Number(row.measured_liters || 0),
    diffLiters: row.diff_liters === null ? null : Number(row.diff_liters || 0),
    diffPercent: row.diff_percent === null ? null : Number(row.diff_percent || 0),
    status: row.status,
    observation: row.observation || "",
    adminAnalysis: row.admin_analysis || "",
    analyzedBy: row.analyzed_by || "",
    analyzedAt: row.analyzed_at || "",
  };
}

function mapDieselAudit(row) {
  return {
    id: row.id,
    entity: row.entity,
    entityId: row.entity_id,
    action: row.action,
    createdAt: row.created_at,
    userId: row.user_id,
    notes: row.notes || "",
    changes: row.changes || {},
  };
}

function mapTankMeasurement(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    measuredAt: row.measured_at,
    company: row.company,
    tankId: row.tank_id,
    pump: row.pump,
    kind: row.kind,
    measureMm: Number(row.measure_mm || 0),
    liters: Number(row.liters || 0),
    photo: row.photo_url || "",
    userId: row.user_id,
  };
}

async function getData() {
  const [users, vehicles, fuelings, pumpClosings, audits, tankMeasurements] = await Promise.all([
    supabase("app_users?select=id,name,email,role,active,created_at&order=name.asc"),
    supabase("vehicles?select=*&order=code.asc"),
    supabase("fuelings?select=*&order=created_at.desc"),
    supabase("pump_closings?select=*&order=date.desc,created_at.desc"),
    supabase("fueling_audits?select=*&order=changed_at.desc").catch(() => []),
    supabase("tank_measurements?select=*&order=measured_at.desc").catch(() => []),
  ]);
  return {
    users,
    vehicles: vehicles.map(mapVehicle),
    fuelings: fuelings.map(mapFueling),
    pumpClosings: pumpClosings.map(mapClosing),
    fuelingAudits: audits.map(mapFuelingAudit),
    tankMeasurements: tankMeasurements.map(mapTankMeasurement),
  };
}

async function requireUser(req) {
  const payload = verify(req.headers.authorization?.replace(/^Bearer\s+/i, ""));
  if (!payload?.id) {
    const error = new Error("Sessao invalida.");
    error.status = 401;
    throw error;
  }
  const rows = await supabase(`app_users?id=eq.${payload.id}&active=eq.true&select=id,name,email,role,active`);
  if (!rows[0]) {
    const error = new Error("Usuario inativo ou nao encontrado.");
    error.status = 401;
    throw error;
  }
  return rows[0];
}

function requireAdmin(user) {
  if (user.role !== "admin") {
    const error = new Error("Apenas administrador pode executar esta acao.");
    error.status = 403;
    throw error;
  }
}

function parseRequestNumber(value) {
  const text = String(value ?? "").trim().replace(/\s/g, "");
  if (!text) return NaN;
  const hasComma = text.includes(",");
  const hasDot = text.includes(".");
  if (hasComma && hasDot) return Number(text.replace(/\./g, "").replace(",", "."));
  if (hasComma) return Number(text.replace(",", "."));
  if (hasDot) {
    const parts = text.split(".");
    if (parts.length > 2) return Number(text.replace(/\./g, ""));
    if ((parts[1] || "").length === 3 && parts[0].length <= 3) return Number(text.replace(".", ""));
    return Number(text);
  }
  return Number(text);
}

async function verifyCurrentPassword(userId, password) {
  const rows = await supabase(`app_users?id=eq.${userId}&active=eq.true&select=password_hash,password_salt`);
  const user = rows[0];
  if (!user || !password) return false;
  const { hash } = hashPassword(password, user.password_salt);
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(user.password_hash));
}

const DIESEL_COMPANIES = ["Belo Monte", "Topbus"];

async function dieselCompaniesForUser(user) {
  if (user.role === "admin") return DIESEL_COMPANIES;
  const rows = await supabase(`diesel_user_companies?user_id=eq.${encodeURIComponent(user.id)}&active=eq.true&select=company`).catch(() => []);
  const companies = rows.map((row) => row.company).filter((company) => DIESEL_COMPANIES.includes(company));
  return companies.length ? companies : DIESEL_COMPANIES;
}

function requireDieselCompanyAccess(userCompanies, company) {
  if (!userCompanies.includes(company)) {
    const error = new Error("Usuario sem acesso a esta empresa.");
    error.status = 403;
    throw error;
  }
}

async function createDieselAudit({ entity, entityId, action, userId, notes = "", changes = {} }) {
  await supabase("diesel_audits", {
    method: "POST",
    body: JSON.stringify({ entity, entity_id: entityId, action, user_id: userId, notes, changes }),
  }).catch(() => null);
}

function nearestArqueacao(rows, measureMm) {
  if (!rows.length || !Number.isFinite(Number(measureMm))) return null;
  return rows
    .slice()
    .sort((a, b) => Math.abs(Number(a.measure_mm) - Number(measureMm)) - Math.abs(Number(b.measure_mm) - Number(measureMm)))[0];
}

function exactArqueacao(rows, measureMm) {
  const value = Number(measureMm);
  if (!Number.isFinite(value)) return null;
  return rows.find((row) => Math.abs(Number(row.measure_mm) - value) < 0.001) || null;
}

async function calculateDieselReceipt(body) {
  const table = await supabase(`diesel_arqueacao?company=eq.${encodeURIComponent(body.company)}&tank_id=eq.${encodeURIComponent(body.tankId)}&active=eq.true&select=*`);
  const toleranceRows = await supabase(`diesel_tolerances?company=eq.${encodeURIComponent(body.company)}&tank_id=eq.${encodeURIComponent(body.tankId)}&active=eq.true&select=*&limit=1`);
  if (!table.length || !toleranceRows[0]) {
    return { status: "Pendente de análise", initialLiters: null, finalLiters: null, measuredLiters: null, diffLiters: null, diffPercent: null };
  }
  const initial = nearestArqueacao(table, body.initialMm);
  const final = nearestArqueacao(table, body.finalMm);
  if (!initial || !final || !Number(body.invoiceLiters)) {
    return { status: "Pendente de análise", initialLiters: null, finalLiters: null, measuredLiters: null, diffLiters: null, diffPercent: null };
  }
  const initialLiters = Number(initial.liters);
  const finalLiters = Number(final.liters);
  const measuredLiters = finalLiters - initialLiters;
  const diffLiters = measuredLiters - Number(body.invoiceLiters);
  const diffPercent = diffLiters / Number(body.invoiceLiters);
  const tolerance = toleranceRows[0];
  const withinLiters = Math.abs(diffLiters) <= Number(tolerance.tolerance_liters || 0);
  const withinPercent = Math.abs(diffPercent) <= Number(tolerance.tolerance_percent || 0) / 100;
  return {
    status: withinLiters || withinPercent ? "Dentro da tolerância" : "Com divergência",
    initialLiters,
    finalLiters,
    measuredLiters,
    diffLiters,
    diffPercent,
    tolerance,
  };
}

function getR2Client() {
  const missing = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"].filter((key) => !process.env[key]);
  if (missing.length) {
    const error = new Error(`Variaveis R2 ausentes: ${missing.join(", ")}`);
    error.status = 500;
    throw error;
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  });
}

async function uploadPhoto(dataUrl, folder) {
  if (!dataUrl) return "";
  const match = String(dataUrl).match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/);
  if (!match) return dataUrl;
  const contentType = match[1];
  const extension = contentType.includes("png") ? "png" : "jpg";
  const key = `${folder}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
  await getR2Client().send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET,
    Key: key,
    Body: Buffer.from(match[2], "base64"),
    ContentType: contentType,
  }));
  return process.env.R2_PUBLIC_URL ? `${process.env.R2_PUBLIC_URL.replace(/\/$/, "")}/${key}` : key;
}

async function handle(req, res) {
  const route = `/${(Array.isArray(req.query.path) ? req.query.path : []).join("/")}`;
  if (req.method === "GET" && route === "/health") return send(res, 200, { ok: true });

  if (req.method === "POST" && route === "/bootstrap-admin") {
    const body = await readBody(req);
    if (process.env.BOOTSTRAP_SECRET && body.secret !== process.env.BOOTSTRAP_SECRET) {
      return send(res, 403, { error: "Segredo de bootstrap invalido." });
    }
    const existing = await supabase("app_users?select=id&limit=1");
    if (existing.length) return send(res, 409, { error: "Ja existe usuario cadastrado." });
    const { salt, hash } = hashPassword(body.password || "Admin@123");
    const rows = await supabase("app_users", {
      method: "POST",
      body: JSON.stringify({
        name: body.name || "Administrador",
        email: body.email || "admin@bmtop.local",
        password_hash: hash,
        password_salt: salt,
        role: "admin",
        active: true,
      }),
    });
    return send(res, 201, { user: rows[0] });
  }

  if (req.method === "POST" && route === "/login") {
    const body = await readBody(req);
    const rows = await supabase(`app_users?email=eq.${encodeURIComponent(body.email)}&active=eq.true&select=*`);
    const user = rows[0];
    if (!user) return send(res, 401, { error: "E-mail ou senha invalidos." });
    const { hash } = hashPassword(body.password || "", user.password_salt);
    if (!crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(user.password_hash))) {
      return send(res, 401, { error: "E-mail ou senha invalidos." });
    }
    const publicUser = { id: user.id, name: user.name, email: user.email, role: user.role, active: user.active };
    const token = sign({ id: user.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 });
    return send(res, 200, { token, user: publicUser, data: await getData() });
  }

  const user = await requireUser(req);
  if (req.method === "GET" && route === "/data") return send(res, 200, { user, data: await getData() });

  if (req.method === "POST" && route === "/me/password") {
    const body = await readBody(req);
    if (!body.newPassword || String(body.newPassword).length < 6) {
      return send(res, 400, { error: "A nova senha precisa ter pelo menos 6 caracteres." });
    }
    const passwordOk = await verifyCurrentPassword(user.id, body.currentPassword);
    if (!passwordOk) return send(res, 401, { error: "Senha atual invalida." });
    const { salt, hash } = hashPassword(body.newPassword);
    await supabase(`app_users?id=eq.${encodeURIComponent(user.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ password_hash: hash, password_salt: salt }),
    });
    return send(res, 200, { ok: true });
  }

  if (req.method === "POST" && route === "/vehicles") {
    requireAdmin(user);
    const body = await readBody(req);
    const rows = await supabase("vehicles", {
      method: "POST",
      body: JSON.stringify({ code: body.code, plate: body.plate, min_avg: body.minAvg, max_avg: body.maxAvg, active: true }),
    });
    return send(res, 201, { vehicle: mapVehicle(rows[0]) });
  }

  if (req.method === "POST" && route === "/vehicles/bulk") {
    requireAdmin(user);
    const body = await readBody(req);
    const rows = await supabase("vehicles", {
      method: "POST",
      body: JSON.stringify(body.vehicles.map((vehicle) => ({
        code: vehicle.code,
        plate: vehicle.plate,
        min_avg: vehicle.minAvg,
        max_avg: vehicle.maxAvg,
        active: true,
      }))),
    });
    return send(res, 201, { vehicles: rows.map(mapVehicle) });
  }

  if (req.method === "POST" && route === "/users") {
    requireAdmin(user);
    const body = await readBody(req);
    const { salt, hash } = hashPassword(body.password);
    const rows = await supabase("app_users", {
      method: "POST",
      body: JSON.stringify({ name: body.name, email: body.email, password_hash: hash, password_salt: salt, role: body.role, active: true }),
    });
    const created = rows[0];
    return send(res, 201, { user: { id: created.id, name: created.name, email: created.email, role: created.role, active: created.active } });
  }

  const userEditMatch = route.match(/^\/users\/([^/]+)$/);
  if (req.method === "PUT" && userEditMatch) {
    requireAdmin(user);
    const targetId = decodeURIComponent(userEditMatch[1]);
    const body = await readBody(req);
    const active = body.active !== false;
    const role = body.role === "admin" ? "admin" : "frentista";

    if (targetId === user.id && !active) {
      return send(res, 400, { error: "Voce nao pode desativar seu proprio usuario." });
    }

    const targetRows = await supabase(`app_users?id=eq.${encodeURIComponent(targetId)}&select=id,role,active`);
    if (!targetRows[0]) return send(res, 404, { error: "Usuario nao encontrado." });

    if (targetRows[0].role === "admin" && targetRows[0].active && (role !== "admin" || !active)) {
      const admins = await supabase("app_users?role=eq.admin&active=eq.true&select=id");
      if (admins.length <= 1) return send(res, 400, { error: "Mantenha pelo menos um administrador ativo." });
    }

    const update = {
      name: body.name,
      email: body.email,
      role,
      active,
    };
    if (body.password) {
      const { salt, hash } = hashPassword(body.password);
      update.password_hash = hash;
      update.password_salt = salt;
    }

    const rows = await supabase(`app_users?id=eq.${encodeURIComponent(targetId)}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    });
    const updated = rows[0];
    return send(res, 200, { user: { id: updated.id, name: updated.name, email: updated.email, role: updated.role, active: updated.active } });
  }

  if (req.method === "POST" && route === "/closings") {
    const body = await readBody(req);
    if (!body.photo) return send(res, 400, { error: "A foto do encerrante e obrigatoria." });
    const createdAt = user.role === "admin" && body.createdAt ? new Date(body.createdAt) : new Date();
    if (Number.isNaN(createdAt.getTime())) return send(res, 400, { error: "Data e hora do encerrante invalidas." });
    const date = createdAt.toISOString().slice(0, 10);
    let initial = body.initial;
    let final = body.final;
    if (body.kind && body.value !== undefined) {
      const value = parseRequestNumber(body.value);
      if (!Number.isFinite(value) || value < 0) return send(res, 400, { error: "Informe um valor de encerrante valido." });
      if (body.kind === "initial") {
        initial = value;
        final = 0;
      } else if (body.kind === "final") {
        initial = 0;
        final = value;
      } else {
        return send(res, 400, { error: "Tipo de encerrante invalido." });
      }
    }
    const photo = await uploadPhoto(body.photo, "pump-closings");
    if (body.replaceId) {
      const existingRows = await supabase(`pump_closings?id=eq.${encodeURIComponent(body.replaceId)}&select=*`);
      const existing = existingRows[0];
      if (!existing) return send(res, 404, { error: "Encerrante para substituicao nao encontrado." });
      if (existing.pump !== body.pump || pumpClosingKind(existing) !== body.kind) {
        return send(res, 400, { error: "O encerrante selecionado nao corresponde a mesma bomba e tipo." });
      }
      const rows = await supabase(`pump_closings?id=eq.${encodeURIComponent(body.replaceId)}`, {
        method: "PATCH",
        body: JSON.stringify({ date, pump: body.pump, initial, final, photo_url: photo, created_at: createdAt.toISOString(), user_id: user.id }),
      });
      return send(res, 200, { closing: mapClosing(rows[0]), replaced: true });
    }
    const rows = await supabase("pump_closings", {
      method: "POST",
      body: JSON.stringify({ date, pump: body.pump, initial, final, photo_url: photo, created_at: createdAt.toISOString(), user_id: user.id }),
    });
    return send(res, 201, { closing: mapClosing(rows[0]) });
  }

  const closingMatch = route.match(/^\/closings\/([^/]+)$/);
  if (req.method === "PUT" && closingMatch) {
    requireAdmin(user);
    const closingId = decodeURIComponent(closingMatch[1]);
    const body = await readBody(req);
    const existingRows = await supabase(`pump_closings?id=eq.${encodeURIComponent(closingId)}&select=*`);
    const existing = existingRows[0];
    if (!existing) return send(res, 404, { error: "Encerrante nao encontrado." });

    const createdAt = body.createdAt ? new Date(body.createdAt) : new Date(existing.created_at);
    if (Number.isNaN(createdAt.getTime())) return send(res, 400, { error: "Data e hora do encerrante invalidas." });
    const value = parseRequestNumber(body.value);
    if (!Number.isFinite(value) || value < 0) return send(res, 400, { error: "Informe um valor de encerrante valido." });

    let initial = 0;
    let final = 0;
    if (body.kind === "initial") initial = value;
    else if (body.kind === "final") final = value;
    else return send(res, 400, { error: "Tipo de encerrante invalido." });

    const update = {
      date: createdAt.toISOString().slice(0, 10),
      pump: body.pump,
      initial,
      final,
      created_at: createdAt.toISOString(),
    };
    if (body.photo) update.photo_url = await uploadPhoto(body.photo, "pump-closings");

    const rows = await supabase(`pump_closings?id=eq.${encodeURIComponent(closingId)}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    });
    return send(res, 200, { closing: mapClosing(rows[0]) });
  }

  if (req.method === "POST" && route === "/fuelings") {
    const body = await readBody(req);
    if (!body.vehicleId || !body.vehiclePhoto || !body.tachographPhoto || !body.pumpPhoto || !body.pump || body.km === undefined || body.km === "" || body.liters === undefined || body.liters === "") {
      return send(res, 400, { error: "Preencha todos os campos obrigatorios do abastecimento." });
    }
    const duplicateSince = encodeURIComponent(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
    const duplicates = await supabase(`fuelings?user_id=eq.${encodeURIComponent(user.id)}&vehicle_id=eq.${encodeURIComponent(body.vehicleId)}&pump=eq.${encodeURIComponent(body.pump)}&km=eq.${encodeURIComponent(body.km)}&liters=eq.${encodeURIComponent(body.liters)}&created_at=gte.${duplicateSince}&select=id&limit=1`);
    if (duplicates.length) {
      return send(res, 409, { error: "Este abastecimento ja foi lancado ha poucos instantes. Confira o historico antes de tentar novamente." });
    }
    const source = body.source === "offline" || body.offlineCreatedAt ? "offline" : "online";
    const offlineCreatedAt = body.offlineCreatedAt ? new Date(body.offlineCreatedAt) : null;
    if (offlineCreatedAt && Number.isNaN(offlineCreatedAt.getTime())) return send(res, 400, { error: "Data do lancamento offline invalida." });
    const createdAt = source === "offline" && offlineCreatedAt ? offlineCreatedAt : new Date();
    const syncedAt = source === "offline" ? new Date() : null;
    const [vehiclePhoto, tachographPhoto, pumpPhoto] = await Promise.all([
      uploadPhoto(body.vehiclePhoto, "fuelings/vehicles"),
      uploadPhoto(body.tachographPhoto, "fuelings/tachographs"),
      uploadPhoto(body.pumpPhoto, "fuelings/pumps"),
    ]);
    const insertPayload = {
      created_at: createdAt.toISOString(),
      vehicle_id: body.vehicleId,
      vehicle_photo_url: vehiclePhoto,
      tachograph_photo_url: tachographPhoto,
      pump: body.pump,
      pump_photo_url: pumpPhoto,
      km: body.km,
      liters: body.liters,
      observation: body.observation || "",
      user_id: user.id,
      source,
      offline_created_at: offlineCreatedAt ? offlineCreatedAt.toISOString() : null,
      synced_at: syncedAt ? syncedAt.toISOString() : null,
    };
    let rows;
    try {
      rows = await supabase("fuelings", {
        method: "POST",
        body: JSON.stringify(insertPayload),
      });
    } catch (error) {
      const message = `${error.message || ""} ${JSON.stringify(error.details || {})}`;
      if (!/source|offline_created_at|synced_at|schema cache/i.test(message)) throw error;
      delete insertPayload.source;
      delete insertPayload.offline_created_at;
      delete insertPayload.synced_at;
      if (source === "offline") {
        const note = `[OFFLINE sincronizado em ${syncedAt.toISOString()}]`;
        insertPayload.observation = `${body.observation || ""}${body.observation ? " " : ""}${note}`;
      }
      rows = await supabase("fuelings", {
        method: "POST",
        body: JSON.stringify(insertPayload),
      });
    }
    return send(res, 201, { fueling: mapFueling(rows[0]) });
  }

  const fuelingMatch = route.match(/^\/fuelings\/([^/]+)$/);
  if (req.method === "PUT" && fuelingMatch) {
    requireAdmin(user);
    const fuelingId = decodeURIComponent(fuelingMatch[1]);
    const body = await readBody(req);
    const justification = String(body.justification || "").trim();
    if (!justification) return send(res, 400, { error: "Informe a justificativa da alteracao." });
    const passwordOk = await verifyCurrentPassword(user.id, body.password);
    if (!passwordOk) return send(res, 401, { error: "Senha invalida para confirmar a alteracao." });

    const existingRows = await supabase(`fuelings?id=eq.${encodeURIComponent(fuelingId)}&select=*`);
    const existing = existingRows[0];
    if (!existing) return send(res, 404, { error: "Abastecimento nao encontrado." });

    const update = {
      vehicle_id: body.vehicleId,
      pump: body.pump,
      km: body.km,
      liters: body.liters,
      observation: body.observation || "",
    };

    if (!update.vehicle_id || !update.pump || update.km === undefined || update.km === "" || update.liters === undefined || update.liters === "") {
      return send(res, 400, { error: "Preencha os campos obrigatorios do abastecimento." });
    }

    const fields = [
      ["vehicleId", "Veiculo", existing.vehicle_id, update.vehicle_id],
      ["pump", "Bomba", existing.pump, update.pump],
      ["km", "Km", Number(existing.km), Number(update.km)],
      ["liters", "Litros", Number(existing.liters), Number(update.liters)],
      ["observation", "Observacao", existing.observation || "", update.observation || ""],
    ];
    const changes = fields
      .filter(([, , before, after]) => String(before) !== String(after))
      .map(([field, label, before, after]) => ({ field, label, before, after }));

    if (!changes.length) return send(res, 400, { error: "Nenhuma alteracao foi identificada." });

    const rows = await supabase(`fuelings?id=eq.${encodeURIComponent(fuelingId)}`, {
      method: "PATCH",
      body: JSON.stringify(update),
    });

    const auditRows = await supabase("fueling_audits", {
      method: "POST",
      body: JSON.stringify({
        fueling_id: fuelingId,
        changed_by: user.id,
        justification,
        changes,
      }),
    });

    return send(res, 200, { fueling: mapFueling(rows[0]), audit: mapFuelingAudit(auditRows[0]) });
  }

  const fuelingDeleteMatch = fuelingMatch;
  if (req.method === "DELETE" && fuelingDeleteMatch) {
    requireAdmin(user);
    const body = await readBody(req);
    const passwordOk = await verifyCurrentPassword(user.id, body.password);
    if (!passwordOk) return send(res, 401, { error: "Senha invalida para confirmar a exclusao." });

    const rows = await supabase(`fuelings?id=eq.${encodeURIComponent(fuelingDeleteMatch[1])}`, {
      method: "DELETE",
    });
    return send(res, 200, { deleted: rows.map(mapFueling) });
  }

  if (req.method === "POST" && route === "/tank-measurements") {
    const body = await readBody(req);
    const userCompanies = await dieselCompaniesForUser(user);
    requireDieselCompanyAccess(userCompanies, body.company);
    if (!body.company || !body.tankId || !body.pump || !["initial", "final"].includes(body.kind) || body.measureMm === undefined || !body.photo) {
      return send(res, 400, { error: "Preencha todos os campos e tire a foto da medicao do tanque." });
    }
    const measuredAt = user.role === "admin" && body.measuredAt ? new Date(body.measuredAt) : new Date();
    if (Number.isNaN(measuredAt.getTime())) return send(res, 400, { error: "Data e hora da medicao invalidas." });
    const measureMm = parseRequestNumber(body.measureMm);
    if (!Number.isFinite(measureMm) || measureMm < 0) return send(res, 400, { error: "Informe uma medida em mm valida." });

    const tankRows = await supabase(`diesel_tanks?id=eq.${encodeURIComponent(body.tankId)}&company=eq.${encodeURIComponent(body.company)}&active=eq.true&select=id`);
    if (!tankRows[0]) return send(res, 400, { error: "Tanque invalido ou inativo para esta empresa." });
    const table = await supabase(`diesel_arqueacao?tank_id=eq.${encodeURIComponent(body.tankId)}&company=eq.${encodeURIComponent(body.company)}&active=eq.true&select=measure_mm,liters`);
    const conversion = exactArqueacao(table, measureMm);
    if (!conversion) return send(res, 400, { error: `A medida ${measureMm} mm nao existe na tabela de arqueacao deste tanque.` });

    const photo = await uploadPhoto(body.photo, "tank-measurements");
    const record = {
      measured_at: measuredAt.toISOString(),
      company: body.company,
      tank_id: body.tankId,
      pump: body.pump,
      kind: body.kind,
      measure_mm: measureMm,
      liters: Number(conversion.liters),
      photo_url: photo,
      user_id: user.id,
    };
    if (body.replaceId) {
      const existingRows = await supabase(`tank_measurements?id=eq.${encodeURIComponent(body.replaceId)}&select=*`);
      const existing = existingRows[0];
      if (!existing) return send(res, 404, { error: "Medicao para substituicao nao encontrada." });
      if (existing.tank_id !== body.tankId || existing.pump !== body.pump || existing.kind !== body.kind) {
        return send(res, 400, { error: "A medicao selecionada nao corresponde ao mesmo tanque, bomba e tipo." });
      }
      const rows = await supabase(`tank_measurements?id=eq.${encodeURIComponent(body.replaceId)}`, { method: "PATCH", body: JSON.stringify(record) });
      return send(res, 200, { measurement: mapTankMeasurement(rows[0]), replaced: true });
    }
    const rows = await supabase("tank_measurements", { method: "POST", body: JSON.stringify(record) });
    return send(res, 201, { measurement: mapTankMeasurement(rows[0]) });
  }

  if (req.method === "GET" && route === "/diesel-receiving/data") {
    const userCompanies = await dieselCompaniesForUser(user);
    const companyFilter = userCompanies.map((company) => `"${company}"`).join(",");
    const [tanks, arqueacao, tolerances, audits] = await Promise.all([
      supabase(`diesel_tanks?company=in.(${companyFilter})&select=*&order=company.asc,name.asc`).catch(() => []),
      supabase(`diesel_arqueacao?company=in.(${companyFilter})&select=*&order=company.asc,measure_mm.asc`).catch(() => []),
      supabase(`diesel_tolerances?company=in.(${companyFilter})&select=*&order=company.asc`).catch(() => []),
      supabase("diesel_audits?select=*&order=created_at.desc").catch(() => []),
    ]);
    const receiptPath = user.role === "admin"
      ? `diesel_receipts?company=in.(${companyFilter})&select=*&order=received_at.desc`
      : `diesel_receipts?company=in.(${companyFilter})&user_id=eq.${encodeURIComponent(user.id)}&select=*&order=received_at.desc`;
    const receipts = await supabase(receiptPath).catch(() => []);
    return send(res, 200, {
      companies: userCompanies,
      tanks: tanks.map(mapDieselTank),
      arqueacao: arqueacao.map(mapDieselArqueacao),
      tolerances: tolerances.map(mapDieselTolerance),
      receipts: receipts.map(mapDieselReceipt),
      audits: audits.map(mapDieselAudit),
    });
  }

  if (req.method === "POST" && route === "/diesel-receiving/tanks") {
    requireAdmin(user);
    const body = await readBody(req);
    if (!DIESEL_COMPANIES.includes(body.company)) return send(res, 400, { error: "Empresa invalida." });
    const rows = await supabase("diesel_tanks", {
      method: "POST",
      body: JSON.stringify({
        company: body.company,
        name: body.name,
        code: body.code,
        fuel_type: body.fuelType,
        nominal_capacity: body.nominalCapacity,
        real_capacity: body.realCapacity,
        height_mm: body.heightMm,
        diameter: body.diameter,
        active: body.active !== false,
      }),
    });
    await createDieselAudit({ entity: "tank", entityId: rows[0].id, action: "create", userId: user.id, changes: body });
    return send(res, 201, { tank: mapDieselTank(rows[0]) });
  }

  if (req.method === "POST" && route === "/diesel-receiving/arqueacao") {
    requireAdmin(user);
    const body = await readBody(req);
    const items = Array.isArray(body.items) ? body.items : [body];
    const rows = await supabase("diesel_arqueacao", {
      method: "POST",
      body: JSON.stringify(items.map((item) => ({
        company: item.company,
        tank_id: item.tankId,
        measure_mm: item.measureMm,
        liters: item.liters,
        active: item.active !== false,
      }))),
    });
    await createDieselAudit({ entity: "arqueacao", entityId: body.tankId || rows[0]?.tank_id, action: "create", userId: user.id, changes: { count: rows.length } });
    return send(res, 201, { arqueacao: rows.map(mapDieselArqueacao) });
  }

  if (req.method === "POST" && route === "/diesel-receiving/tolerances") {
    requireAdmin(user);
    const body = await readBody(req);
    const rows = await supabase("diesel_tolerances", {
      method: "POST",
      body: JSON.stringify({
        company: body.company,
        tank_id: body.tankId,
        tolerance_liters: body.toleranceLiters,
        tolerance_percent: body.tolerancePercent,
        active: body.active !== false,
      }),
    });
    await createDieselAudit({ entity: "tolerance", entityId: rows[0].id, action: "create", userId: user.id, changes: body });
    return send(res, 201, { tolerance: mapDieselTolerance(rows[0]) });
  }

  if (req.method === "POST" && route === "/diesel-receiving/receipts") {
    const body = await readBody(req);
    const userCompanies = await dieselCompaniesForUser(user);
    requireDieselCompanyAccess(userCompanies, body.company);
    if (!body.company || !body.tankId || !body.receivedAt || !body.trailerPlate || !body.supplier || !body.invoiceNumber || !body.invoiceLiters || !body.sealedTruckPhoto || !body.initialPhoto || !body.finalPhoto) {
      return send(res, 400, { error: "Preencha todos os campos obrigatorios do recebimento." });
    }
    if (Number(body.invoiceLiters) <= 0) return send(res, 400, { error: "Quantidade da nota fiscal precisa ser maior que zero." });
    if (Number(body.finalMm) < Number(body.initialMm)) return send(res, 400, { error: "Medicao final nao pode ser menor que a inicial." });
    const calc = await calculateDieselReceipt(body);
    const [sealedTruckPhoto, initialPhoto, finalPhoto] = await Promise.all([
      uploadPhoto(body.sealedTruckPhoto, "diesel-receiving/trucks"),
      uploadPhoto(body.initialPhoto, "diesel-receiving/initial-ruler"),
      uploadPhoto(body.finalPhoto, "diesel-receiving/final-ruler"),
    ]);
    const rows = await supabase("diesel_receipts", {
      method: "POST",
      body: JSON.stringify({
        company: body.company,
        tank_id: body.tankId,
        received_at: body.receivedAt,
        user_id: user.id,
        trailer_plate: body.trailerPlate,
        supplier: body.supplier,
        invoice_number: body.invoiceNumber,
        invoice_liters: body.invoiceLiters,
        sealed_truck_photo_url: sealedTruckPhoto,
        initial_mm: body.initialMm,
        initial_liters: calc.initialLiters,
        initial_photo_url: initialPhoto,
        final_mm: body.finalMm,
        final_liters: calc.finalLiters,
        final_photo_url: finalPhoto,
        measured_liters: calc.measuredLiters,
        diff_liters: calc.diffLiters,
        diff_percent: calc.diffPercent,
        status: calc.status,
        observation: body.observation || "",
      }),
    });
    await createDieselAudit({ entity: "receipt", entityId: rows[0].id, action: "create", userId: user.id, changes: { status: calc.status } });
    return send(res, 201, { receipt: mapDieselReceipt(rows[0]) });
  }

  const dieselAnalyzeMatch = route.match(/^\/diesel-receiving\/receipts\/([^/]+)\/analyze$/);
  if (req.method === "PUT" && dieselAnalyzeMatch) {
    requireAdmin(user);
    const body = await readBody(req);
    const receiptId = decodeURIComponent(dieselAnalyzeMatch[1]);
    const rows = await supabase(`diesel_receipts?id=eq.${encodeURIComponent(receiptId)}`, {
      method: "PATCH",
      body: JSON.stringify({ admin_analysis: body.adminAnalysis || "", analyzed_by: user.id, analyzed_at: new Date().toISOString() }),
    });
    await createDieselAudit({ entity: "receipt", entityId: receiptId, action: "analyze", userId: user.id, notes: body.adminAnalysis || "" });
    return send(res, 200, { receipt: mapDieselReceipt(rows[0]) });
  }

  return send(res, 404, { error: "Rota nao encontrada." });
}

module.exports = async function api(req, res) {
  try {
    await handle(req, res);
  } catch (error) {
    send(res, error.status || 500, { error: error.message || "Erro interno.", details: error.details });
  }
};
