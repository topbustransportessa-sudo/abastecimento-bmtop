const SESSION_KEY = "abastecimento-bmtop-session";
const USER_KEY = "abastecimento-bmtop-user";
const DATA_KEY = "abastecimento-bmtop-data";
const OFFLINE_DB = "abastecimento-bmtop-offline";
const PUMP_COUNTER_LIMIT = 100000;

const icons = {
  dashboard: "M3 13h8V3H3v10Zm10 8h8V3h-8v18ZM3 21h8v-6H3v6Z",
  fuel: "M4 3h10v18H4V3Zm10 6h2.5L20 12.5V19a2 2 0 0 1-4 0v-4h-2M7 7h4",
  bus: "M5 16V6a3 3 0 0 1 3-3h8a3 3 0 0 1 3 3v10M4 16h16M7 20h.01M17 20h.01M6 16v3h12v-3M8 7h8v4H8V7Z",
  users: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75",
  gauge: "M12 14l4-4M4 14a8 8 0 1 1 16 0M5 19h14",
  export: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3",
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2ZM17 21v-8H7v8M7 3v5h8",
  menu: "M4 6h16M4 12h16M4 18h16",
  plus: "M12 5v14M5 12h14",
  camera: "M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2v11ZM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z",
  trash: "M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15",
  edit: "M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5Z",
  close: "M18 6 6 18M6 6l12 12",
};

const app = document.querySelector("#app");
let state = loadState();
let sessionToken = localStorage.getItem(SESSION_KEY) || "";
let currentUserId = localStorage.getItem(USER_KEY) || "";
let route = "dashboard";
let filters = { from: "", to: "", vehicle: "", pump: "", status: "" };
let closingFilters = { from: "", to: "", pump: "", status: "" };
let fuelingsSort = { key: "date", direction: "desc" };
let sidebarOpen = false;
let showFuelingForm = false;
let detailFuelingId = "";
let deleteTargetId = "";
let editFuelingId = "";
let editClosingId = "";
let closingPhotoPreview = null;
let editUserId = "";
let showChangePassword = false;
let fuelingSubmitting = false;
let offlinePendingCount = 0;
let offlineSyncing = false;
let dieselReceivingData = { companies: [], tanks: [], arqueacao: [], tolerances: [], receipts: [], audits: [] };
let dieselReceivingLoading = false;
let dieselReceivingView = "launch";
let dieselReceivingDetailId = "";
let dieselReceivingFilters = { company: "", from: "", to: "", attendant: "", supplier: "", trailerPlate: "", tank: "", status: "", divergence: "" };

function seedState() {
  return {
    users: [],
    vehicles: [],
    pumpClosings: [],
    fuelings: [],
    fuelingAudits: [],
  };
}

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(DATA_KEY)) || seedState();
  } catch {
    return seedState();
  }
}

function saveState() {
  if (sessionToken) localStorage.setItem(SESSION_KEY, sessionToken);
  else localStorage.removeItem(SESSION_KEY);
  if (currentUserId) localStorage.setItem(USER_KEY, currentUserId);
  else localStorage.removeItem(USER_KEY);
  localStorage.setItem(DATA_KEY, JSON.stringify(state));
}

function clearSession() {
  sessionToken = "";
  currentUserId = "";
  saveState();
}

function applyRemoteData(data) {
  state.users = data.users || [];
  state.vehicles = data.vehicles || [];
  state.fuelings = data.fuelings || [];
  state.pumpClosings = data.pumpClosings || [];
  state.fuelingAudits = data.fuelingAudits || [];
}

async function apiRequest(path, options = {}) {
  let response;
  try {
    response = await fetch(`/api${path}`, {
      ...options,
      headers: {
        "content-type": "application/json",
        ...(sessionToken ? { authorization: `Bearer ${sessionToken}` } : {}),
        ...(options.headers || {}),
      },
    });
  } catch (error) {
    error.network = true;
    throw error;
  }
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || "Erro ao conversar com o servidor.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function refreshData() {
  const payload = await apiRequest("/data");
  currentUserId = payload.user.id;
  applyRemoteData(payload.data);
  saveState();
}

function offlineDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DB, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("fuelings")) db.createObjectStore("fuelings", { keyPath: "localId" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function offlineStore(mode = "readonly") {
  const db = await offlineDb();
  return db.transaction("fuelings", mode).objectStore("fuelings");
}

async function enqueueOfflineFueling(payload) {
  const item = {
    localId: `offline-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    createdAt: new Date().toISOString(),
    userId: currentUserId,
    payload,
  };
  const store = await offlineStore("readwrite");
  await new Promise((resolve, reject) => {
    const request = store.add(item);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
  await refreshOfflinePendingCount();
  return item;
}

async function getOfflineFuelings() {
  const store = await offlineStore();
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

async function deleteOfflineFueling(localId) {
  const store = await offlineStore("readwrite");
  await new Promise((resolve, reject) => {
    const request = store.delete(localId);
    request.onsuccess = resolve;
    request.onerror = () => reject(request.error);
  });
}

async function refreshOfflinePendingCount() {
  try {
    offlinePendingCount = (await getOfflineFuelings()).length;
  } catch {
    offlinePendingCount = 0;
  }
}

async function syncOfflineFuelings() {
  if (offlineSyncing || !sessionToken || !navigator.onLine) return;
  const items = await getOfflineFuelings();
  if (!items.length) {
    await refreshOfflinePendingCount();
    render();
    return;
  }

  offlineSyncing = true;
  render();
  let synced = 0;
  try {
    for (const item of items) {
      try {
        const payload = await apiRequest("/fuelings", {
          method: "POST",
          body: JSON.stringify({
            ...item.payload,
            source: "offline",
            offlineCreatedAt: item.createdAt,
          }),
        });
        state.fuelings.unshift(payload.fueling);
        await deleteOfflineFueling(item.localId);
        synced += 1;
      } catch (error) {
        if (error.status === 409) {
          await deleteOfflineFueling(item.localId);
          continue;
        }
        if (error.status === 401) {
          clearSession();
          toast("Sessão expirada. Entre novamente para sincronizar os lançamentos pendentes.");
          break;
        }
        if (error.network) break;
        throw error;
      }
    }
    await refreshOfflinePendingCount();
    saveState();
    if (synced) toast(`${synced} lançamento(s) sincronizado(s).`);
  } catch (error) {
    toast(error.message || "Não foi possível sincronizar os lançamentos pendentes.");
  } finally {
    offlineSyncing = false;
    render();
  }
}

async function init() {
  await refreshOfflinePendingCount();
  if (!sessionToken) {
    renderLogin();
    return;
  }
  try {
    await refreshData();
    render();
    syncOfflineFuelings();
  } catch (error) {
    if (error.status === 401) {
      clearSession();
      renderLogin();
      toast("Sessão expirada. Entre novamente para continuar.");
      return;
    }
    if (currentUserId && state.users.length) {
      render();
      toast("Sem conexão. O sistema está usando os dados salvos neste aparelho.");
      return;
    }
    sessionToken = "";
    currentUserId = "";
    saveState();
    renderLogin();
  }
}

function uid(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function localDateTimeInput(value = new Date()) {
  const date = new Date(value);
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDate(value) {
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function moneyless(value, digits = 0) {
  return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: digits });
}

function icon(name) {
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${icons[name] || icons.dashboard}"></path></svg>`;
}

function currentUser() {
  if (!currentUserId) return null;
  return state.users.find((user) => user.id === currentUserId) || null;
}

function vehicleById(id) {
  return state.vehicles.find((vehicle) => vehicle.id === id);
}

function userById(id) {
  return state.users.find((user) => user.id === id);
}

function auditsByFuelingId(id) {
  return (state.fuelingAudits || [])
    .filter((audit) => audit.fuelingId === id)
    .sort((a, b) => new Date(b.changedAt) - new Date(a.changedAt));
}

function formatAuditValue(change, value) {
  if (value === null || value === undefined || value === "") return "-";
  if (change.field === "vehicleId") {
    const vehicle = vehicleById(value);
    return vehicle ? `${vehicle.code} - ${vehicle.plate}` : value;
  }
  if (change.field === "km") return moneyless(value);
  if (change.field === "liters") return formatNumber(value);
  return String(value);
}

function filteredFuelings() {
  const fromTime = filters.from ? new Date(filters.from).getTime() : null;
  const toTime = filters.to ? new Date(filters.to).getTime() : null;
  return sortFuelings(state.fuelings
    .filter((item) => {
      const time = new Date(item.createdAt).getTime();
      return (!fromTime || time >= fromTime)
        && (!toTime || time <= toTime)
        && (!filters.vehicle || item.vehicleId === filters.vehicle)
        && (!filters.pump || item.pump === filters.pump)
        && (!filters.status || consumptionStatus(item).key === filters.status);
    }));
}

function previousFueling(item) {
  return state.fuelings
    .filter((candidate) => candidate.vehicleId === item.vehicleId && new Date(candidate.createdAt) < new Date(item.createdAt))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

function latestFuelingForVehicle(vehicleId) {
  return state.fuelings
    .filter((candidate) => candidate.vehicleId === vehicleId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
}

function consumption(item) {
  const previous = previousFueling(item);
  if (!previous || !Number(item.liters)) return null;
  const distance = Number(item.km) - Number(previous.km);
  if (distance <= 0) return { average: 0, distance, previousKm: previous.km, repeated: distance === 0 };
  return { average: distance / Number(item.liters), distance, previousKm: previous.km, repeated: false };
}

function fuelingSortValue(item, key) {
  const data = consumption(item);
  const vehicle = vehicleById(item.vehicleId);
  const user = userById(item.userId);
  const values = {
    date: new Date(item.createdAt).getTime(),
    origin: fuelingOriginLabel(item),
    vehicle: vehicle?.code || "",
    km: Number(item.km || 0),
    distance: data ? Number(data.distance || 0) : -Infinity,
    liters: Number(item.liters || 0),
    average: data ? Number(data.average || 0) : -Infinity,
    status: consumptionStatus(item).label,
    pump: Number(item.pump || 0),
    user: user?.name || "",
    observation: fuelingObservation(item),
    photos: [item.vehiclePhoto, item.tachographPhoto, item.pumpPhoto].filter(Boolean).length,
  };
  return values[key] ?? "";
}

function sortFuelings(items) {
  const direction = fuelingsSort.direction === "asc" ? 1 : -1;
  return items.slice().sort((a, b) => {
    const aValue = fuelingSortValue(a, fuelingsSort.key);
    const bValue = fuelingSortValue(b, fuelingsSort.key);
    if (typeof aValue === "number" && typeof bValue === "number") return (aValue - bValue) * direction;
    return String(aValue).localeCompare(String(bValue), "pt-BR", { numeric: true }) * direction;
  });
}

function sortableHeader(label, key) {
  const active = fuelingsSort.key === key;
  const arrow = active ? (fuelingsSort.direction === "asc" ? "▲" : "▼") : "↕";
  return `<th><button class="sort-header ${active ? "active" : ""}" data-sort="${key}"><span>${label}</span><span>${arrow}</span></button></th>`;
}

function consumptionStatus(item) {
  const data = consumption(item);
  const vehicle = vehicleById(item.vehicleId);
  if (!data || !vehicle) return { key: "info", label: "Sem base", className: "info" };
  if (data.distance <= 0) return { key: "odometer", label: "Km repetido", className: "bad" };
  const lowLimit = Number(vehicle.minAvg);
  const highLimit = Number(vehicle.maxAvg);
  if (data.average < lowLimit * 0.75) return { key: "very-low", label: "Muito baixa", className: "bad" };
  if (data.average < lowLimit) return { key: "low", label: "Baixa", className: "warn" };
  if (data.average > highLimit * 1.25) return { key: "very-high", label: "Muito alta", className: "bad" };
  if (data.average > highLimit) return { key: "high", label: "Alta", className: "warn" };
  return { key: "ok", label: "Dentro da faixa", className: "ok" };
}

function fuelingOriginLabel(item) {
  return item.source === "offline" || item.offlineCreatedAt ? "Offline" : "Online";
}

function fuelingOriginBadge(item) {
  const offline = item.source === "offline" || item.offlineCreatedAt;
  const synced = item.syncedAt ? `<small class="table-note">Sincronizado em ${formatDate(item.syncedAt)}</small>` : "";
  return `<span class="badge ${offline ? "warn" : "ok"}">${offline ? "Offline" : "Online"}</span>${offline ? synced : ""}`;
}

function fuelingObservation(item) {
  return String(item.observation || "").replace(/\s*\[OFFLINE[^\]]*\]\s*/gi, " ").trim();
}

function closingKind(item) {
  if (Number(item.initial || 0) > 0 && Number(item.final || 0) > 0) return "both";
  if (Number(item.final || 0) > 0) return "final";
  return "initial";
}

function closingValue(item) {
  return closingKind(item) === "final" ? Number(item.final || 0) : Number(item.initial || 0);
}

function closingKindLabel(item) {
  const labels = { initial: "Inicial", final: "Final", both: "Inicial e final" };
  return labels[closingKind(item)];
}

function closingTime(item) {
  if (!item) return 0;
  const time = new Date(item.createdAt || item.date).getTime();
  return Number.isFinite(time) ? time : 0;
}

function latestClosingValue(items, kind) {
  const row = items
    .filter((item) => closingKind(item) === kind || closingKind(item) === "both")
    .sort((a, b) => closingTime(b) - closingTime(a))[0];
  if (!row) return null;
  return kind === "final" ? Number(row.final || 0) : Number(row.initial || 0);
}

function latestClosingCycle(pump) {
  const cycles = closingCycles().filter((item) => item.pump === pump);
  const latest = cycles[0];
  if (latest) return latest;
  return { pump, status: "pending", initial: null, final: null, measured: 0, launched: 0, diff: 0, fuels: [] };
}

function closingFuelsInPeriod(pump, start, end) {
  return state.fuelings.filter((item) => {
    const time = new Date(item.createdAt).getTime();
    return item.pump === pump && time >= start && time <= end;
  });
}

function pendingFinalEndTime(initial) {
  const end = new Date(closingTime(initial));
  end.setDate(end.getDate() + 1);
  end.setHours(2, 30, 0, 0);
  return end.getTime();
}

function buildClosingCycle(pump, initial, final) {
  const start = closingKind(final) === "both" ? new Date(`${final.date}T00:00:00`).getTime() : closingTime(initial);
  const end = closingKind(final) === "both" ? new Date(`${final.date}T23:59:59`).getTime() : closingTime(final);
  const fuels = closingFuelsInPeriod(pump, start, end);
  const initialValue = Number(initial.initial || 0);
  const finalValue = Number(final.final || 0);
  const rolledOver = finalValue < initialValue;
  const measured = rolledOver ? (PUMP_COUNTER_LIMIT - initialValue) + finalValue : finalValue - initialValue;
  const launched = fuels.reduce((sum, item) => sum + Number(item.liters || 0), 0);
  const diff = measured - launched;
  const status = Math.abs(diff) <= 1 ? "ok" : "divergent";
  return { pump, status, initial, final, measured, launched, diff, fuels, start, end, rolledOver };
}

function buildPendingFinalCycle(pump, initial) {
  const start = closingTime(initial);
  const end = pendingFinalEndTime(initial);
  const fuels = closingFuelsInPeriod(pump, start, end);
  const launched = fuels.reduce((sum, item) => sum + Number(item.liters || 0), 0);
  return {
    pump,
    status: "pending",
    initial,
    final: null,
    measured: 0,
    launched,
    diff: 0,
    fuels,
    start,
    end,
    pendingReason: "Sem final",
    launchedNote: "Soma até 02:30 por falta do encerrante final.",
  };
}

function closingCycles() {
  const cycles = [];
  ["1", "2", "3", "4", "5", "6"].forEach((pump) => {
    const items = state.pumpClosings
      .filter((item) => item.pump === pump)
      .sort((a, b) => closingTime(a) - closingTime(b));
    let initial = null;
    items.forEach((item) => {
      const kind = closingKind(item);
      if (kind === "both") {
        cycles.push(buildClosingCycle(pump, item, item));
        initial = null;
      } else if (kind === "initial") {
        if (initial) {
          cycles.push(buildPendingFinalCycle(pump, initial));
        }
        initial = item;
      } else if (kind === "final" && initial) {
        cycles.push(buildClosingCycle(pump, initial, item));
        initial = null;
      } else if (kind === "final") {
        cycles.push({ pump, status: "pending", initial: null, final: item, measured: 0, launched: 0, diff: 0, fuels: [], start: null, end: closingTime(item), pendingReason: "Sem inicial" });
      }
    });
    if (initial) {
      cycles.push(buildPendingFinalCycle(pump, initial));
    }
  });
  return cycles.sort((a, b) => (b.end || b.start || 0) - (a.end || a.start || 0));
}

function filteredClosingCycles() {
  const fromTime = closingFilters.from ? new Date(closingFilters.from).getTime() : null;
  const toTime = closingFilters.to ? new Date(closingFilters.to).getTime() : null;
  return closingCycles().filter((item) => {
    const start = item.start || item.end || closingTime(item.initial) || closingTime(item.final);
    const end = item.end || item.start || start;
    return (!fromTime || end >= fromTime)
      && (!toTime || start <= toTime)
      && (!closingFilters.pump || item.pump === closingFilters.pump)
      && (!closingFilters.status || item.status === closingFilters.status);
  });
}

function pumpDiff(date = today(), pump = "") {
  const groups = pump ? [pump] : ["1", "2", "3", "4", "5", "6"];
  return groups.reduce((total, groupPump) => {
    const cycle = latestClosingCycle(groupPump);
    return {
      measured: total.measured + cycle.measured,
      launched: total.launched + cycle.launched,
      diff: total.diff + cycle.diff,
      closings: total.closings + state.pumpClosings.filter((item) => item.pump === groupPump).length,
      fuels: total.fuels + cycle.fuels.length,
    };
  }, { measured: 0, launched: 0, diff: 0, closings: 0, fuels: 0 });
}

function photoPreview(value) {
  return value ? `<div class="photo-preview"><img src="${value}" alt="Foto anexada"></div>` : "";
}

function photoLink(value, label) {
  if (!value) return `<div class="photo-card empty"><span>${label}</span><strong>Sem foto</strong></div>`;
  return `
    <a class="photo-card" href="${value}" target="_blank" rel="noopener">
      <img src="${value}" alt="${label}">
      <span>${label}</span>
    </a>
  `;
}

function closingPhotoButton(item, value) {
  if (!item) return "-";
  const formatted = formatNumber(value);
  if (!item.photo) return formatted;
  return `<button class="table-link" data-action="view-closing-photo" data-id="${item.id}" type="button">${formatted}</button>`;
}

function renderClosingPhotoModal() {
  if (!closingPhotoPreview) return "";
  const item = state.pumpClosings.find((closing) => closing.id === closingPhotoPreview.id);
  if (!item?.photo) return "";
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <section class="modal photo-modal">
        <div class="panel-header">
          <div>
            <h2>Foto do encerrante ${closingPhotoPreview.kind === "final" ? "final" : "inicial"}</h2>
            <p>Bomba ${item.pump} - ${formatDate(item.createdAt)}</p>
          </div>
          <button class="icon-btn" data-action="close-closing-photo" title="Fechar">${icon("close")}</button>
        </div>
        <img class="modal-photo" src="${item.photo}" alt="Foto do encerrante">
      </section>
    </div>
  `;
}

function render() {
  const user = currentUser();
  if (!user) {
    renderLogin();
    return;
  }
  let content = "";
  try {
    content = renderRoute();
  } catch (error) {
    console.error(error);
    content = `<section class="panel alert-panel"><h2>Erro ao carregar página</h2><p>${error.message || "Atualize a página e tente novamente."}</p></section>`;
  }
  app.innerHTML = `
    <div class="app-shell">
      ${renderSidebar(user)}
      <section class="main">
        <header class="topbar">
          <div class="actions">
            <button class="icon-btn mobile-menu" data-action="toggle-menu" title="Menu">${icon(sidebarOpen ? "close" : "menu")}</button>
            <div>
              <h1 class="page-title">${pageMeta().title}</h1>
              <p class="page-subtitle">${pageMeta().subtitle}</p>
            </div>
          </div>
          <div class="actions">
            ${renderOfflineStatus()}
            ${route === "fuelings" ? `<button class="button" data-action="open-fueling">${icon("fuel")} Lançar abastecimento</button>` : ""}
            <span class="badge ${user.role === "admin" ? "ok" : "info"}">${user.role === "admin" ? "Administrador" : "Frentista"}</span>
          </div>
        </header>
        <div class="content">${content}</div>
      </section>
      ${renderFuelingDetails()}
      ${renderEditFuelingModal()}
      ${renderEditClosingModal()}
      ${renderClosingPhotoModal()}
      ${renderDeleteFuelingModal()}
      ${renderEditUserModal()}
      ${renderChangePasswordModal()}
    </div>
  `;
  bindEvents();
}

function renderOfflineStatus() {
  if (offlineSyncing) return `<span class="sync-status info">Sincronizando...</span>`;
  if (offlinePendingCount) return `<button class="sync-status warn" data-action="sync-offline">${offlinePendingCount} pendente(s)</button>`;
  if (!navigator.onLine) return `<span class="sync-status bad">Offline</span>`;
  return `<span class="sync-status ok">Online</span>`;
}

function renderLogin() {
  app.innerHTML = `
    <section class="login-shell">
      <form class="login-panel" data-form="login">
        <div class="brand-lockup">
          <img src="assets/logo-transimao.png" alt="Transimão">
          <div>
            <h1 class="brand-title">Abastecimento BMTOP</h1>
            <p class="brand-subtitle">Controle do posto interno</p>
          </div>
        </div>
        <div class="field">
          <label for="email">E-mail</label>
          <input id="email" name="email" type="email" autocomplete="username" required>
        </div>
        <div class="field">
          <label for="password">Senha</label>
          <input id="password" name="password" type="password" autocomplete="current-password" required>
        </div>
        <button class="button" type="submit">${icon("users")} Entrar</button>
        <p class="status-line">Acesso criado pelo administrador do sistema.</p>
      </form>
    </section>
  `;
  bindEvents();
}

function renderSidebar(user) {
  const items = [
    ["dashboard", "Dashboard", "dashboard"],
    ["fuelings", "Abastecimentos", "gauge"],
    ["diesel-receiving", "Recebimento de Diesel", "fuel"],
    ["closings", "Encerrantes", "export"],
    ["vehicles", "Veículos", "bus"],
  ];
  if (user.role === "admin") {
    items.push(["users", "Usuários", "users"]);
  }
  return `
    <aside class="sidebar ${sidebarOpen ? "open" : ""}">
      <div class="brand-lockup">
        <img src="assets/logo-transimao.png" alt="Transimão">
        <div>
          <h2 class="brand-title">BMTOP</h2>
          <p class="brand-subtitle">Diesel interno</p>
        </div>
      </div>
      <nav class="nav">
        ${items.map(([id, label, glyph]) => `<button class="${route === id ? "active" : ""}" data-route="${id}">${icon(glyph)} ${label}</button>`).join("")}
      </nav>
      <div class="sidebar-footer">
        <strong>${user.name}</strong><br>
        ${user.email}
        <button class="logout-btn secondary" data-action="change-password">Trocar senha</button>
        <button class="logout-btn" data-action="logout">Sair</button>
      </div>
    </aside>
  `;
}

function pageMeta() {
  const data = {
    dashboard: ["Dashboard", "Indicadores, alertas e conciliação do diesel."],
    fuelings: ["Abastecimentos", "Histórico com médias, alertas e exportação."],
    "diesel-receiving": ["Recebimento de Diesel", "Recebimento por carreta, régua e divergências."],
    closings: ["Encerrantes", "Controle inicial e final das bombas."],
    vehicles: ["Veículos", "Cadastro das faixas de consumo km/l."],
    users: ["Usuários", "Acesso e perfis administrados."],
  };
  const [title, subtitle] = data[route] || data.dashboard;
  return { title, subtitle };
}

function renderRoute() {
  if (route === "fuelings") return renderFuelings();
  if (route === "diesel-receiving") return renderDieselReceiving();
  if (route === "closings") return renderClosings();
  if (route === "vehicles") return renderVehicles();
  if (route === "users") return currentUser().role === "admin" ? renderUsers() : renderDashboard();
  return renderDashboard();
}

function renderDashboard() {
  const list = filteredFuelings();
  const totalLiters = list.reduce((sum, item) => sum + Number(item.liters || 0), 0);
  const alertItems = state.fuelings
    .map((item) => ({ item, status: consumptionStatus(item), data: consumption(item) }))
    .filter(({ status }) => status.key !== "ok" && status.key !== "info")
    .slice(0, 6);
  const diff = pumpDiff();
  return `
    <section class="grid three">
      <div class="metric"><span>Litros filtrados</span><strong>${formatNumber(totalLiters)}</strong><small>${list.length} abastecimentos</small></div>
      <div class="metric"><span>Diferença encerrante</span><strong>${formatNumber(diff.diff)}</strong><small>${formatNumber(diff.measured)} encerrante x ${formatNumber(diff.launched)} abastecimentos</small></div>
      <div class="metric"><span>Veículos monitorados</span><strong>${state.vehicles.length}</strong><small>${state.vehicles.filter((v) => v.active).length} ativos</small></div>
    </section>
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Ações rápidas</h2>
          <p>Atalhos para a rotina do posto.</p>
        </div>
      </div>
      <div class="quick-actions">
        <button class="quick-action" data-action="open-fueling">${icon("fuel")} Lançar abastecimento</button>
        <button class="quick-action" data-route="closings">${icon("export")} Lançar encerrante</button>
        <button class="quick-action" data-action="export">${icon("export")} Exportar Excel</button>
      </div>
    </section>
    <section class="grid two">
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Alertas de consumo</h2>
            <p>Médias fora da faixa e odômetros repetidos.</p>
          </div>
        </div>
        <div class="alert-list">
          ${alertItems.length ? alertItems.map(({ item, status, data }) => `
            <div class="alert ${status.className}">
              <strong>${vehicleById(item.vehicleId)?.code || "Veículo"} - ${status.label}</strong>
              ${data ? `${formatNumber(data.average)} km/l, km atual ${moneyless(item.km)} e anterior ${moneyless(data.previousKm)}.` : "Sem base anterior para cálculo."}
            </div>
          `).join("") : `<div class="empty-state">Nenhum alerta encontrado.</div>`}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Conciliação por ciclo</h2>
            <p>Encerrante final menos inicial precisa bater com os abastecimentos no intervalo.</p>
          </div>
        </div>
        ${renderPumpSummary()}
      </div>
    </section>
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Filtros</h2>
          <p>Use no dashboard e no histórico.</p>
        </div>
      </div>
      ${renderFilters()}
    </section>
  `;
}

function renderFilters() {
  return `
    <div class="filters" data-filter-box>
      <div class="field"><label>De</label><input type="datetime-local" name="from" value="${filters.from}"></div>
      <div class="field"><label>Até</label><input type="datetime-local" name="to" value="${filters.to}"></div>
      <div class="field"><label>Veículo</label><select name="vehicle"><option value="">Todos</option>${vehicleOptions(filters.vehicle)}</select></div>
      <div class="field"><label>Bomba</label><select name="pump"><option value="">Todas</option>${pumpOptions(filters.pump)}</select></div>
      <div class="field"><label>Status</label><select name="status">
        <option value="">Todos</option>
        <option value="ok" ${filters.status === "ok" ? "selected" : ""}>Dentro da faixa</option>
        <option value="low" ${filters.status === "low" ? "selected" : ""}>Baixa</option>
        <option value="very-low" ${filters.status === "very-low" ? "selected" : ""}>Muito baixa</option>
        <option value="high" ${filters.status === "high" ? "selected" : ""}>Alta</option>
        <option value="very-high" ${filters.status === "very-high" ? "selected" : ""}>Muito alta</option>
        <option value="odometer" ${filters.status === "odometer" ? "selected" : ""}>Km repetido</option>
      </select></div>
    </div>
  `;
}

function renderFuelingForm() {
  return `
    <form class="panel" data-form="fueling">
      <div class="panel-header">
        <div>
          <h2>Lançamento de abastecimento</h2>
          <p>A data e hora são registradas automaticamente pelo sistema.</p>
        </div>
      </div>
      <div class="form-grid">
        <div class="field"><label>Data e hora</label><input value="${formatDate(new Date().toISOString())}" readonly></div>
        <div class="field vehicle-combobox"><label>Veículo</label><input data-vehicle-search type="search" placeholder="Digite prefixo, placa ou descrição" autocomplete="off" required><input name="vehicleId" type="hidden"><div class="vehicle-suggestions hidden" data-vehicle-suggestions></div></div>
        <div class="field"><label>Foto do carro</label><input name="vehiclePhoto" type="file" accept="image/*" capture="environment" required></div>
        <div class="mobile-photo-preview hidden" data-photo-preview-for="vehiclePhoto"></div>
        <div class="field"><label>Foto do tacógrafo</label><input name="tachographPhoto" type="file" accept="image/*" capture="environment" required></div>
        <div class="mobile-photo-preview hidden" data-photo-preview-for="tachographPhoto"></div>
        <div class="field full hidden" data-after-photo="tachographPhoto"><label>Km atual</label><input name="km" type="number" min="0" step="1" required disabled><div class="km-guidance" data-km-guidance></div></div>
        <div class="field"><label>Bomba</label><select name="pump" required><option value="">Selecione</option>${pumpOptions()}</select></div>
        <div class="field"><label>Foto do encerrante</label><input name="pumpPhoto" type="file" accept="image/*" capture="environment" required></div>
        <div class="mobile-photo-preview hidden" data-photo-preview-for="pumpPhoto"></div>
        <div class="field full hidden" data-after-photo="pumpPhoto"><label>Litros</label><input name="liters" type="number" min="0.01" step="0.01" required disabled></div>
        <div class="field full"><label>Observação</label><textarea name="observation" placeholder="Ex.: abastecimento parcial, odômetro parado, divergência na bomba..."></textarea></div>
      </div>
      <div class="status-line" data-live-preview></div>
      <div class="actions" style="margin-top:14px">
        <button class="button" type="submit">${icon("save")} Salvar lançamento</button>
        <button class="button secondary" type="button" data-action="close-fueling">Fechar</button>
      </div>
    </form>
  `;
}

function renderFuelings() {
  const rows = filteredFuelings();
  return `
    ${showFuelingForm ? renderFuelingForm() : ""}
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Histórico</h2>
          <p>${rows.length} registros encontrados.</p>
        </div>
        <div class="row-actions">
          <button class="button secondary" data-action="export">${icon("export")} Exportar</button>
          <button class="button secondary" data-action="export-txt-erp">${icon("export")} TXT ERP</button>
        </div>
      </div>
      ${renderFilters()}
    </section>
    <section class="table-wrap">
      <table>
        <thead><tr>
          ${sortableHeader("Data", "date")}
          ${sortableHeader("Origem", "origin")}
          ${sortableHeader("Veículo", "vehicle")}
          ${sortableHeader("Km", "km")}
          ${sortableHeader("Km percorrido", "distance")}
          ${sortableHeader("Litros", "liters")}
          ${sortableHeader("Média", "average")}
          ${sortableHeader("Status", "status")}
          ${sortableHeader("Bomba", "pump")}
          ${sortableHeader("Frentista", "user")}
          ${sortableHeader("Obs.", "observation")}
          ${sortableHeader("Fotos", "photos")}
          <th>Ações</th>
        </tr></thead>
        <tbody>
          ${rows.map((item) => {
            const status = consumptionStatus(item);
            const data = consumption(item);
            const isAdmin = currentUser()?.role === "admin";
            return `<tr>
              <td>${formatDate(item.createdAt)}</td>
              <td>${fuelingOriginBadge(item)}</td>
              <td>${vehicleById(item.vehicleId)?.code || "-"}</td>
              <td>${moneyless(item.km)}</td>
              <td>${data ? moneyless(data.distance) : "-"}</td>
              <td>${formatNumber(item.liters)}</td>
              <td>${data ? formatNumber(data.average) : "-"}</td>
              <td><span class="badge ${status.className}">${status.label}</span></td>
              <td>${item.pump}</td>
              <td>${userById(item.userId)?.name || "-"}</td>
              <td>${fuelingObservation(item) || "-"}</td>
              <td>${[item.vehiclePhoto, item.tachographPhoto, item.pumpPhoto].filter(Boolean).length} anexos</td>
              <td><div class="row-actions"><button class="icon-btn" data-action="detail-fueling" data-id="${item.id}" title="Detalhes">${icon("dashboard")}</button>${isAdmin ? `<button class="icon-btn" data-action="edit-fueling" data-id="${item.id}" title="Editar">${icon("edit")}</button><button class="icon-btn danger" data-action="request-delete-fueling" data-id="${item.id}" title="Excluir">${icon("trash")}</button>` : ""}</div></td>
            </tr>`;
          }).join("") || `<tr><td colspan="13">Nenhum abastecimento encontrado.</td></tr>`}
        </tbody>
      </table>
    </section>
  `;
}

function renderFuelingDetails() {
  if (!detailFuelingId) return "";
  const item = state.fuelings.find((fueling) => fueling.id === detailFuelingId);
  if (!item) return "";
  const data = consumption(item);
  const status = consumptionStatus(item);
  const vehicle = vehicleById(item.vehicleId);
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <section class="modal">
        <div class="panel-header">
          <div>
            <h2>Detalhes do abastecimento</h2>
            <p>${formatDate(item.createdAt)} - Bomba ${item.pump}</p>
          </div>
          <button class="icon-btn" data-action="close-detail" title="Fechar">${icon("close")}</button>
        </div>
        <div class="detail-grid">
          <div><span>Veículo</span><strong>${vehicle ? `${vehicle.code} - ${vehicle.plate}` : "-"}</strong></div>
          <div><span>Frentista</span><strong>${userById(item.userId)?.name || "-"}</strong></div>
          <div><span>Origem</span><strong>${fuelingOriginBadge(item)}</strong></div>
          ${item.offlineCreatedAt ? `<div><span>Lançado offline</span><strong>${formatDate(item.offlineCreatedAt)}</strong></div>` : ""}
          ${item.syncedAt ? `<div><span>Sincronizado</span><strong>${formatDate(item.syncedAt)}</strong></div>` : ""}
          <div><span>Km atual</span><strong>${moneyless(item.km)}</strong></div>
          <div><span>Litros</span><strong>${formatNumber(item.liters)}</strong></div>
          <div><span>Média calculada</span><strong>${data ? `${formatNumber(data.average)} km/l` : "-"}</strong></div>
          <div><span>Status</span><strong><span class="badge ${status.className}">${status.label}</span></strong></div>
          <div><span>Km anterior</span><strong>${data ? moneyless(data.previousKm) : "-"}</strong></div>
          <div><span>Distância</span><strong>${data ? moneyless(data.distance) : "-"}</strong></div>
          <div class="full"><span>Observação</span><strong>${fuelingObservation(item) || "-"}</strong></div>
        </div>
        <div class="photo-grid">
          ${photoLink(item.vehiclePhoto, "Foto do carro")}
          ${photoLink(item.tachographPhoto, "Foto do tacógrafo")}
          ${photoLink(item.pumpPhoto, "Foto do encerrante")}
        </div>
        ${renderFuelingAuditHistory(item.id)}
      </section>
    </div>
  `;
}

function renderFuelingAuditHistory(fuelingId) {
  const audits = auditsByFuelingId(fuelingId);
  return `
    <section class="audit-history">
      <h3>Histórico de alterações</h3>
      ${audits.length ? audits.map((audit) => `
        <div class="audit-card">
          <div class="audit-meta">
            <strong>${formatDate(audit.changedAt)}</strong>
            <span>${userById(audit.changedBy)?.name || "-"}</span>
          </div>
          <p>${audit.justification}</p>
          <div class="audit-changes">
            ${(audit.changes || []).map((change) => `<div><span>${change.label}</span><strong>${formatAuditValue(change, change.before)} → ${formatAuditValue(change, change.after)}</strong></div>`).join("")}
          </div>
        </div>
      `).join("") : `<div class="empty-state">Nenhuma alteração registrada.</div>`}
    </section>
  `;
}

function renderEditFuelingModal() {
  if (!editFuelingId) return "";
  const item = state.fuelings.find((fueling) => fueling.id === editFuelingId);
  if (!item) return "";
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <form class="modal compact" data-form="edit-fueling">
        <div class="panel-header">
          <div>
            <h2>Editar abastecimento</h2>
            <p>Informe justificativa e senha para confirmar.</p>
          </div>
          <button class="icon-btn" type="button" data-action="cancel-edit-fueling" title="Fechar">${icon("close")}</button>
        </div>
        <div class="form-grid single">
          <div class="field"><label>Veículo</label><select name="vehicleId" required>${vehicleOptions(item.vehicleId)}</select></div>
          <div class="field"><label>Km atual</label><input name="km" type="number" min="0" step="1" value="${item.km}" required></div>
          <div class="field"><label>Bomba</label><select name="pump" required>${pumpOptions(item.pump)}</select></div>
          <div class="field"><label>Litros</label><input name="liters" type="number" min="0.01" step="0.01" value="${item.liters}" required></div>
          <div class="field"><label>Observação</label><textarea name="observation">${fuelingObservation(item)}</textarea></div>
          <div class="field"><label>Justificativa da alteração</label><textarea name="justification" required placeholder="Explique o motivo da correção"></textarea></div>
          <div class="field"><label>Senha do administrador</label><input name="password" type="password" autocomplete="current-password" required></div>
        </div>
        <div class="actions" style="margin-top:14px">
          <button class="button" type="submit">${icon("save")} Salvar alteração</button>
          <button class="button secondary" type="button" data-action="cancel-edit-fueling">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function renderEditClosingModal() {
  if (!editClosingId) return "";
  const item = state.pumpClosings.find((closing) => closing.id === editClosingId);
  if (!item) return "";
  const kind = closingKind(item);
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <form class="modal compact" data-form="edit-closing">
        <div class="panel-header">
          <div>
            <h2>Editar encerrante</h2>
            <p>Apenas administradores podem alterar lançamentos de encerrante.</p>
          </div>
          <button class="icon-btn" type="button" data-action="cancel-edit-closing" title="Fechar">${icon("close")}</button>
        </div>
        <div class="form-grid single">
          <div class="field"><label>Data e hora</label><input name="createdAt" type="datetime-local" value="${localDateTimeInput(item.createdAt)}" required></div>
          <div class="field"><label>Bomba</label><select name="pump" required>${pumpOptions(item.pump)}</select></div>
          <div class="field"><label>Tipo de lançamento</label><select name="kind" required><option value="initial" ${kind !== "final" ? "selected" : ""}>Encerrante inicial</option><option value="final" ${kind === "final" ? "selected" : ""}>Encerrante final</option></select></div>
          <div class="field"><label>Valor do encerrante</label><input name="value" type="text" inputmode="decimal" placeholder="Ex.: 85119,70" value="${decimalInputValue(closingValue(item))}" required></div>
          <div class="field"><label>Foto atual</label>${item.photo ? `<a href="${item.photo}" target="_blank" rel="noopener">Ver foto atual</a>` : `<span class="status-line">Sem foto salva</span>`}</div>
          <div class="field"><label>Substituir foto</label><input name="photo" type="file" accept="image/*" capture="environment" ${item.photo ? "" : "required"}></div>
          <div class="mobile-photo-preview hidden" data-photo-preview-for="photo"></div>
        </div>
        <div class="actions" style="margin-top:14px">
          <button class="button" type="submit">${icon("save")} Salvar alteração</button>
          <button class="button secondary" type="button" data-action="cancel-edit-closing">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function renderDeleteFuelingModal() {
  if (!deleteTargetId) return "";
  const item = state.fuelings.find((fueling) => fueling.id === deleteTargetId);
  if (!item) return "";
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <form class="modal compact" data-form="delete-fueling">
        <div class="panel-header">
          <div>
            <h2>Excluir abastecimento</h2>
            <p>Confirme com sua senha de administrador.</p>
          </div>
          <button class="icon-btn" type="button" data-action="cancel-delete-fueling" title="Fechar">${icon("close")}</button>
        </div>
        <p class="status-line">Registro de ${formatDate(item.createdAt)}, veículo ${vehicleById(item.vehicleId)?.code || "-"}, ${formatNumber(item.liters)} litros.</p>
        <div class="field"><label>Senha</label><input name="password" type="password" autocomplete="current-password" required></div>
        <div class="actions" style="margin-top:14px">
          <button class="button danger" type="submit">${icon("trash")} Confirmar exclusão</button>
          <button class="button secondary" type="button" data-action="cancel-delete-fueling">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function renderPumpSummary() {
  const lines = ["1", "2", "3", "4", "5", "6"].map((pump) => {
    const item = latestClosingCycle(pump);
    const klass = item.status === "ok" ? "ok" : item.status === "divergent" ? "bad" : "info";
    const status = item.status === "ok" ? "OK" : item.status === "divergent" ? "Divergência" : `Pendente${item.pendingReason ? `: ${item.pendingReason}` : ""}`;
    return `<tr><td>Bomba ${pump}</td><td>${item.initial ? closingPhotoButton(item.initial, item.initial.initial) : "-"}</td><td>${item.initial ? formatDate(item.initial.createdAt) : "-"}</td><td>${item.final ? closingPhotoButton(item.final, item.final.final) : "-"}</td><td>${item.final ? formatDate(item.final.createdAt) : "-"}</td><td>${formatNumber(item.measured)}${item.rolledOver ? ` <span class="badge info">Virou</span>` : ""}</td><td>${formatNumber(item.launched)}${item.launchedNote ? `<small class="table-note">${item.launchedNote}</small>` : ""}</td><td><span class="badge ${klass}">${formatNumber(item.diff)}</span></td><td><span class="badge ${klass}">${status}</span></td></tr>`;
  }).join("");
  return `<div class="table-wrap"><table><thead><tr><th>Bomba</th><th>Inicial</th><th>Hora inicial</th><th>Final</th><th>Hora final</th><th>Litragem encerrante</th><th>Soma abastecimentos</th><th>Diferença</th><th>Status</th></tr></thead><tbody>${lines}</tbody></table></div>`;
}

function renderClosingFilters() {
  return `
    <div class="filters" data-closing-filter>
      <div class="field"><label>De</label><input type="datetime-local" name="from" value="${closingFilters.from}"></div>
      <div class="field"><label>Até</label><input type="datetime-local" name="to" value="${closingFilters.to}"></div>
      <div class="field"><label>Bomba</label><select name="pump"><option value="">Todas</option>${pumpOptions(closingFilters.pump)}</select></div>
      <div class="field"><label>Status</label><select name="status">
        <option value="">Todos</option>
        <option value="ok" ${closingFilters.status === "ok" ? "selected" : ""}>OK</option>
        <option value="divergent" ${closingFilters.status === "divergent" ? "selected" : ""}>Divergência</option>
        <option value="pending" ${closingFilters.status === "pending" ? "selected" : ""}>Pendente</option>
      </select></div>
    </div>
  `;
}

function renderClosingCycleList() {
  const rows = filteredClosingCycles();
  return `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Conciliação por período</h2>
          <p>${rows.length} ciclo(s) encontrado(s). Cada linha compara o intervalo entre inicial e final.</p>
        </div>
      </div>
      ${renderClosingFilters()}
    </section>
    <section class="table-wrap">
      <table>
        <thead><tr><th>Início</th><th>Fim</th><th>Bomba</th><th>Inicial</th><th>Final</th><th>Litragem encerrante</th><th>Soma abastecimentos</th><th>Diferença</th><th>Abastecimentos</th><th>Status</th></tr></thead>
        <tbody>${rows.map((item) => {
          const klass = item.status === "ok" ? "ok" : item.status === "divergent" ? "bad" : "info";
          const status = item.status === "ok" ? "OK" : item.status === "divergent" ? "Divergência" : `Pendente${item.pendingReason ? `: ${item.pendingReason}` : ""}`;
          return `<tr>
            <td>${item.initial ? formatDate(item.initial.createdAt) : "-"}</td>
            <td>${item.final ? formatDate(item.final.createdAt) : "-"}</td>
            <td>Bomba ${item.pump}</td>
            <td>${item.initial ? closingPhotoButton(item.initial, item.initial.initial) : "-"}</td>
            <td>${item.final ? closingPhotoButton(item.final, item.final.final) : "-"}</td>
            <td>${formatNumber(item.measured)}${item.rolledOver ? ` <span class="badge info">Virou</span>` : ""}</td>
            <td>${formatNumber(item.launched)}${item.launchedNote ? `<small class="table-note">${item.launchedNote}</small>` : ""}</td>
            <td><span class="badge ${klass}">${formatNumber(item.diff)}</span></td>
            <td>${item.fuels.length}</td>
            <td><span class="badge ${klass}">${status}</span></td>
          </tr>`;
        }).join("") || `<tr><td colspan="10">Nenhuma conciliação encontrada.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function companyOptions(selected = "") {
  const companies = dieselReceivingData.companies.length ? dieselReceivingData.companies : ["Belo Monte", "Topbus"];
  return companies.map((company) => `<option value="${company}" ${selected === company ? "selected" : ""}>${company}</option>`).join("");
}

function dieselTanksForCompany(company) {
  return dieselReceivingData.tanks.filter((tank) => tank.active && (!company || tank.company === company));
}

function tankOptions(company = "", selected = "") {
  return dieselTanksForCompany(company).map((tank) => `<option value="${tank.id}" ${selected === tank.id ? "selected" : ""}>${tank.name} - ${tank.code}</option>`).join("");
}

function nearestDieselArqueacao(tankId, measureMm) {
  const rows = (dieselReceivingData.arqueacao || []).filter((item) => item.tankId === tankId && item.active);
  if (!rows.length || !Number.isFinite(Number(measureMm))) return null;
  return rows.slice().sort((a, b) => Math.abs(Number(a.measureMm) - Number(measureMm)) - Math.abs(Number(b.measureMm) - Number(measureMm)))[0];
}

function simulateDieselReceipt(data) {
  const invoiceLiters = Number(data.invoiceLiters || 0);
  const initialMm = Number(data.initialMm);
  const finalMm = Number(data.finalMm);
  if (!data.tankId || !invoiceLiters || !Number.isFinite(initialMm) || !Number.isFinite(finalMm)) {
    return { status: "Pendente de análise", message: "Informe tanque, litros da NF, medição inicial e medição final para simular." };
  }
  if (finalMm < initialMm) return { status: "Pendente de análise", message: "Medição final menor que a inicial." };
  const tolerance = (dieselReceivingData.tolerances || []).find((item) => item.tankId === data.tankId && item.active);
  const initial = nearestDieselArqueacao(data.tankId, initialMm);
  const final = nearestDieselArqueacao(data.tankId, finalMm);
  if (!initial || !final || !tolerance) return { status: "Pendente de análise", message: "Falta tabela de arqueação ou tolerância para esse tanque." };
  const measuredLiters = Number(final.liters) - Number(initial.liters);
  const diffLiters = measuredLiters - invoiceLiters;
  const diffPercent = diffLiters / invoiceLiters;
  const withinLiters = Math.abs(diffLiters) <= Number(tolerance.toleranceLiters || 0);
  const withinPercent = Math.abs(diffPercent) <= Number(tolerance.tolerancePercent || 0) / 100;
  const message = Number(initial.measureMm) === initialMm && Number(final.measureMm) === finalMm ? "" : `Atenção: usada medida mais próxima (${initial.measureMm} mm e ${final.measureMm} mm).`;
  return { status: withinLiters || withinPercent ? "Dentro da tolerância" : "Com divergência", initial, final, measuredLiters, diffLiters, diffPercent, tolerance, message };
}

function dieselReceiptConversion(item) {
  const initialRow = nearestDieselArqueacao(item.tankId, item.initialMm);
  const finalRow = nearestDieselArqueacao(item.tankId, item.finalMm);
  const initialLiters = item.initialLiters !== null && item.initialLiters !== undefined ? Number(item.initialLiters) : (initialRow ? Number(initialRow.liters) : null);
  const finalLiters = item.finalLiters !== null && item.finalLiters !== undefined ? Number(item.finalLiters) : (finalRow ? Number(finalRow.liters) : null);
  const measuredLiters = item.measuredLiters !== null && item.measuredLiters !== undefined ? Number(item.measuredLiters) : (initialLiters !== null && finalLiters !== null ? finalLiters - initialLiters : null);
  const diffLiters = item.diffLiters !== null && item.diffLiters !== undefined ? Number(item.diffLiters) : (measuredLiters !== null ? measuredLiters - Number(item.invoiceLiters || 0) : null);
  const diffPercent = item.diffPercent !== null && item.diffPercent !== undefined ? Number(item.diffPercent) : (diffLiters !== null && Number(item.invoiceLiters) > 0 ? diffLiters / Number(item.invoiceLiters) : null);
  const notes = [];
  if ((item.initialLiters === null || item.initialLiters === undefined) && initialRow) notes.push(`Inicial convertido pela tabela atual: ${initialRow.measureMm} mm.`);
  if ((item.finalLiters === null || item.finalLiters === undefined) && finalRow) notes.push(`Final convertido pela tabela atual: ${finalRow.measureMm} mm.`);
  if (!initialRow || !finalRow) notes.push("Tabela de arqueação não encontrada para uma das medições.");
  return { initialRow, finalRow, initialLiters, finalLiters, measuredLiters, diffLiters, diffPercent, notes };
}

function renderDieselSimulationPreview(result) {
  const klass = result.status === "Com divergência" ? "bad" : result.status === "Dentro da tolerância" ? "ok" : "info";
  if (result.measuredLiters === undefined) {
    return `<div class="simulation-card ${klass}"><div class="simulation-head"><strong>Simulação de divergência</strong><span class="badge ${klass}">${result.status}</span></div><p>${result.message}</p></div>`;
  }
  return `
    <div class="simulation-card ${klass}">
      <div class="simulation-head"><strong>Simulação de divergência</strong><span class="badge ${klass}">${result.status}</span></div>
      <div class="simulation-grid">
        <div><span>Litros inicial</span><strong>${formatNumber(result.initial.liters)} L</strong></div>
        <div><span>Litros final</span><strong>${formatNumber(result.final.liters)} L</strong></div>
        <div><span>Apurado pela régua</span><strong>${formatNumber(result.measuredLiters)} L</strong></div>
        <div><span>Diferença</span><strong>${formatNumber(result.diffLiters)} L</strong></div>
        <div><span>Diferença %</span><strong>${formatNumber(result.diffPercent * 100)}%</strong></div>
        <div><span>Tolerância</span><strong>${formatNumber(result.tolerance.toleranceLiters)} L / ${formatNumber(result.tolerance.tolerancePercent)}%</strong></div>
      </div>
      ${result.message ? `<p>${result.message}</p>` : ""}
    </div>
  `;
}

async function ensureDieselReceivingData() {
  if (dieselReceivingData.loaded || dieselReceivingLoading) return;
  dieselReceivingLoading = true;
  try {
    const data = await apiRequest("/diesel-receiving/data");
    dieselReceivingData = { ...data, loaded: true };
  } catch (error) {
    dieselReceivingData.loaded = true;
    toast(error.message || "Não foi possível carregar recebimentos.");
  } finally {
    dieselReceivingLoading = false;
  }
}

function renderDieselReceiving() {
  if (!dieselReceivingData.loaded && !dieselReceivingLoading) {
    ensureDieselReceivingData().then(() => route === "diesel-receiving" && render());
  }
  const admin = currentUser()?.role === "admin";
  return `
    <section class="panel">
      <div class="tabs">
        ${["launch", "report", "dashboard"].map((id) => `<button class="${dieselReceivingView === id ? "active" : ""}" data-diesel-view="${id}">${id === "launch" ? "Lançamento" : id === "report" ? "Relatório" : "Dashboard"}</button>`).join("")}
        ${admin ? `<button class="${dieselReceivingView === "settings" ? "active" : ""}" data-diesel-view="settings">Configurações</button>` : ""}
      </div>
    </section>
    ${dieselReceivingDetailId ? renderDieselReceiptDetail() : ""}
    ${dieselReceivingView === "report" ? renderDieselReceivingReport() : dieselReceivingView === "dashboard" ? renderDieselReceivingDashboard() : dieselReceivingView === "settings" && admin ? renderDieselReceivingSettings() : renderDieselReceivingLaunch()}
  `;
}

function renderDieselReceivingLaunch() {
  const companies = dieselReceivingData.companies || [];
  const company = companies.length === 1 ? companies[0] : "";
  return `
    <form class="panel" data-form="diesel-receipt">
      <div class="panel-header"><div><h2>Novo recebimento</h2><p>Registre o diesel recebido por carreta/tanque.</p></div></div>
      <div class="form-grid">
        <div class="field"><label>Empresa</label><select name="company" required ${companies.length === 1 ? "readonly" : ""}><option value="">Selecione</option>${companyOptions(company)}</select></div>
        <div class="field"><label>Tanque</label><select name="tankId" required><option value="">Selecione a empresa</option>${tankOptions(company)}</select></div>
        <div class="field"><label>Data e hora</label><input name="receivedAt" type="datetime-local" value="${new Date().toISOString().slice(0, 16)}" required></div>
        <div class="field"><label>Frentista</label><input value="${currentUser()?.name || ""}" readonly></div>
        <div class="field"><label>Placa da carreta</label><input name="trailerPlate" required></div>
        <div class="field"><label>Fornecedor</label><input name="supplier" required></div>
        <div class="field"><label>Número da nota fiscal</label><input name="invoiceNumber" required></div>
        <div class="field"><label>Quantidade NF em litros</label><input name="invoiceLiters" type="number" min="0.01" step="0.01" required></div>
        <div class="field"><label>Foto da carreta lacrada</label><input name="sealedTruckPhoto" type="file" accept="image/*" capture="environment" required></div>
        <div class="field"><label>Medição inicial mm</label><input name="initialMm" type="number" min="0" step="1" required></div>
        <div class="field"><label>Foto medição inicial</label><input name="initialPhoto" type="file" accept="image/*" capture="environment" required></div>
        <div class="field"><label>Medição final mm</label><input name="finalMm" type="number" min="0" step="1" required></div>
        <div class="field"><label>Foto medição final</label><input name="finalPhoto" type="file" accept="image/*" capture="environment" required></div>
        <div class="field full"><label>Observação</label><textarea name="observation"></textarea></div>
      </div>
      <div class="status-line" data-diesel-preview>${renderDieselSimulationPreview({ status: "Pendente de análise", message: "Informe tanque, litros da NF, medição inicial e medição final para simular." })}</div>
      <div class="actions" style="margin-top:14px"><button class="button" type="submit">${icon("save")} Salvar recebimento</button></div>
    </form>
  `;
}

function filteredDieselReceipts() {
  return (dieselReceivingData.receipts || []).filter((item) => {
    const date = item.receivedAt?.slice(0, 10);
    return (!dieselReceivingFilters.company || item.company === dieselReceivingFilters.company)
      && (!dieselReceivingFilters.from || date >= dieselReceivingFilters.from)
      && (!dieselReceivingFilters.to || date <= dieselReceivingFilters.to)
      && (!dieselReceivingFilters.attendant || item.userId === dieselReceivingFilters.attendant)
      && (!dieselReceivingFilters.supplier || item.supplier.toLowerCase().includes(dieselReceivingFilters.supplier.toLowerCase()))
      && (!dieselReceivingFilters.trailerPlate || item.trailerPlate.toLowerCase().includes(dieselReceivingFilters.trailerPlate.toLowerCase()))
      && (!dieselReceivingFilters.tank || item.tankId === dieselReceivingFilters.tank)
      && (!dieselReceivingFilters.status || item.status === dieselReceivingFilters.status)
      && (!dieselReceivingFilters.divergence || (dieselReceivingFilters.divergence === "yes" ? item.status === "Com divergência" : item.status !== "Com divergência"));
  });
}

function renderDieselReceivingReport() {
  const rows = filteredDieselReceipts();
  return `
    <section class="panel">
      <div class="panel-header"><div><h2>Relatório</h2><p>${rows.length} recebimento(s).</p></div><button class="button secondary" data-action="export-diesel-receipts">${icon("export")} Exportar</button></div>
      <div class="filters" data-diesel-filter>
        <div class="field"><label>Empresa</label><select name="company"><option value="">Todas</option>${companyOptions(dieselReceivingFilters.company)}</select></div>
        <div class="field"><label>De</label><input type="date" name="from" value="${dieselReceivingFilters.from}"></div>
        <div class="field"><label>Até</label><input type="date" name="to" value="${dieselReceivingFilters.to}"></div>
        <div class="field"><label>Fornecedor</label><input name="supplier" value="${dieselReceivingFilters.supplier}"></div>
        <div class="field"><label>Placa</label><input name="trailerPlate" value="${dieselReceivingFilters.trailerPlate}"></div>
        <div class="field"><label>Tanque</label><select name="tank"><option value="">Todos</option>${tankOptions("", dieselReceivingFilters.tank)}</select></div>
        <div class="field"><label>Status</label><select name="status"><option value="">Todos</option><option ${dieselReceivingFilters.status === "Dentro da tolerância" ? "selected" : ""}>Dentro da tolerância</option><option ${dieselReceivingFilters.status === "Com divergência" ? "selected" : ""}>Com divergência</option><option ${dieselReceivingFilters.status === "Pendente de análise" ? "selected" : ""}>Pendente de análise</option></select></div>
        <div class="field"><label>Divergência</label><select name="divergence"><option value="">Todos</option><option value="yes" ${dieselReceivingFilters.divergence === "yes" ? "selected" : ""}>Com divergência</option><option value="no" ${dieselReceivingFilters.divergence === "no" ? "selected" : ""}>Sem divergência</option></select></div>
      </div>
    </section>
    <section class="table-wrap"><table><thead><tr><th>Data</th><th>Empresa</th><th>Tanque</th><th>Fornecedor</th><th>Placa</th><th>NF litros</th><th>Inicial L</th><th>Final L</th><th>Apurado</th><th>Dif. L</th><th>Dif. %</th><th>Status</th><th>Detalhes</th></tr></thead><tbody>
      ${rows.map((item) => {
        const conversion = dieselReceiptConversion(item);
        return `<tr><td>${formatDate(item.receivedAt)}</td><td>${item.company}</td><td>${dieselReceivingData.tanks.find((tank) => tank.id === item.tankId)?.name || "-"}</td><td>${item.supplier}</td><td>${item.trailerPlate}</td><td>${formatNumber(item.invoiceLiters)}</td><td>${conversion.initialLiters === null ? "-" : formatNumber(conversion.initialLiters)}</td><td>${conversion.finalLiters === null ? "-" : formatNumber(conversion.finalLiters)}</td><td>${conversion.measuredLiters === null ? "-" : formatNumber(conversion.measuredLiters)}</td><td>${conversion.diffLiters === null ? "-" : formatNumber(conversion.diffLiters)}</td><td>${conversion.diffPercent === null ? "-" : formatNumber(conversion.diffPercent * 100)}%</td><td><span class="badge ${item.status === "Com divergência" ? "bad" : item.status === "Dentro da tolerância" ? "ok" : "info"}">${item.status}</span></td><td><button class="icon-btn" data-action="diesel-detail" data-id="${item.id}">${icon("dashboard")}</button></td></tr>`;
      }).join("") || `<tr><td colspan="13">Nenhum recebimento encontrado.</td></tr>`}
    </tbody></table></section>
  `;
}

function renderDieselReceivingDashboard() {
  const rows = filteredDieselReceipts();
  const total = rows.reduce((sum, item) => sum + Number(dieselReceiptConversion(item).measuredLiters || 0), 0);
  const diff = rows.reduce((sum, item) => sum + Number(dieselReceiptConversion(item).diffLiters || 0), 0);
  const divergent = rows.filter((item) => item.status === "Com divergência").length;
  return `<section class="grid three"><div class="metric"><span>Total recebido</span><strong>${formatNumber(total)}</strong><small>litros apurados</small></div><div class="metric"><span>Com divergência</span><strong>${divergent}</strong><small>${rows.length} recebimentos</small></div><div class="metric"><span>Diferença total</span><strong>${formatNumber(diff)}</strong><small>litros</small></div></section>${renderDieselReceivingReport()}`;
}

function renderDieselReceivingSettings() {
  return `
    <section class="grid three">
      <form class="panel" data-form="diesel-tank">
        <h2>Cadastro de tanque</h2>
        <div class="field"><label>Empresa</label><select name="company" required>${companyOptions()}</select></div>
        <div class="field"><label>Nome</label><input name="name" required></div>
        <div class="field"><label>Código</label><input name="code" required></div>
        <div class="field"><label>Tipo</label><select name="fuelType" required><option>Diesel S10</option><option>Diesel S500</option><option>ARLA</option><option>Outro</option></select></div>
        <div class="field"><label>Capacidade nominal</label><input name="nominalCapacity" type="number" step="0.01" required></div>
        <div class="field"><label>Capacidade real</label><input name="realCapacity" type="number" step="0.01" required></div>
        <div class="field"><label>Altura mm</label><input name="heightMm" type="number" step="1" required></div>
        <div class="field"><label>Diâmetro</label><input name="diameter" type="number" step="0.01" required></div>
        <button class="button" type="submit">${icon("plus")} Salvar tanque</button>
      </form>
      <form class="panel" data-form="diesel-arqueacao">
        <h2>Tabela de arqueação</h2>
        <div class="field"><label>Empresa</label><select name="company" required>${companyOptions()}</select></div>
        <div class="field"><label>Tanque</label><select name="tankId" required>${tankOptions()}</select></div>
        <div class="field"><label>Importação manual/CSV</label><textarea name="rows" required placeholder="100; 1500&#10;220; 6500"></textarea></div>
        <p class="status-line">Uma linha por medida: mm; litros. Aceita colar do Excel.</p>
        <button class="button" type="submit">${icon("plus")} Importar tabela</button>
      </form>
      <form class="panel" data-form="diesel-tolerance">
        <h2>Tolerância</h2>
        <div class="field"><label>Empresa</label><select name="company" required>${companyOptions()}</select></div>
        <div class="field"><label>Tanque</label><select name="tankId" required>${tankOptions()}</select></div>
        <div class="field"><label>Tolerância litros</label><input name="toleranceLiters" type="number" step="0.01" required></div>
        <div class="field"><label>Tolerância percentual</label><input name="tolerancePercent" type="number" step="0.01" required></div>
        <button class="button" type="submit">${icon("plus")} Salvar tolerância</button>
      </form>
    </section>
  `;
}

function renderDieselReceiptDetail() {
  const item = dieselReceivingData.receipts.find((receipt) => receipt.id === dieselReceivingDetailId);
  if (!item) return "";
  const tank = dieselReceivingData.tanks.find((candidate) => candidate.id === item.tankId);
  const tolerance = dieselReceivingData.tolerances.find((candidate) => candidate.tankId === item.tankId && candidate.active);
  const conversion = dieselReceiptConversion(item);
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <section class="modal">
        <div class="panel-header"><div><h2>Detalhes do recebimento</h2><p>${item.company} - ${tank?.name || "-"}</p></div><button class="icon-btn" data-action="close-diesel-detail">${icon("close")}</button></div>
        <div class="detail-grid">
          <div><span>Data</span><strong>${formatDate(item.receivedAt)}</strong></div>
          <div><span>Frentista</span><strong>${userById(item.userId)?.name || "-"}</strong></div>
          <div><span>Fornecedor</span><strong>${item.supplier}</strong></div>
          <div><span>Placa</span><strong>${item.trailerPlate}</strong></div>
          <div><span>Nota fiscal</span><strong>${item.invoiceNumber}</strong></div>
          <div><span>NF litros</span><strong>${formatNumber(item.invoiceLiters)}</strong></div>
          <div><span>Inicial</span><strong>${item.initialMm} mm / ${conversion.initialLiters === null ? "-" : formatNumber(conversion.initialLiters)} L</strong></div>
          <div><span>Final</span><strong>${item.finalMm} mm / ${conversion.finalLiters === null ? "-" : formatNumber(conversion.finalLiters)} L</strong></div>
          <div><span>Apurado</span><strong>${conversion.measuredLiters === null ? "-" : formatNumber(conversion.measuredLiters)} L</strong></div>
          <div><span>Diferença</span><strong>${conversion.diffLiters === null ? "-" : formatNumber(conversion.diffLiters)} L</strong></div>
          <div><span>Diferença %</span><strong>${conversion.diffPercent === null ? "-" : `${formatNumber(conversion.diffPercent * 100)}%`}</strong></div>
          <div><span>Status</span><strong><span class="badge ${item.status === "Com divergência" ? "bad" : item.status === "Dentro da tolerância" ? "ok" : "info"}">${item.status}</span></strong></div>
          <div><span>Tolerância usada</span><strong>${tolerance ? `${formatNumber(tolerance.toleranceLiters)} L / ${formatNumber(tolerance.tolerancePercent)}%` : "-"}</strong></div>
          <div class="full"><span>Litros convertidos</span><strong>Final ${conversion.finalLiters === null ? "-" : formatNumber(conversion.finalLiters)} L - Inicial ${conversion.initialLiters === null ? "-" : formatNumber(conversion.initialLiters)} L = ${conversion.measuredLiters === null ? "-" : formatNumber(conversion.measuredLiters)} L</strong>${conversion.notes.length ? `<small class="table-note">${conversion.notes.join(" ")}</small>` : ""}</div>
          <div class="full"><span>Observação frentista</span><strong>${item.observation || "-"}</strong></div>
          <div class="full"><span>Análise administrador</span><strong>${item.adminAnalysis || "-"}</strong></div>
        </div>
        <div class="photo-grid">${photoLink(item.sealedTruckPhoto, "Carreta lacrada")}${photoLink(item.initialPhoto, "Régua inicial")}${photoLink(item.finalPhoto, "Régua final")}</div>
        ${currentUser()?.role === "admin" ? `<form class="panel" data-form="diesel-analysis" style="margin-top:14px"><div class="field"><label>Análise/observação do administrador</label><textarea name="adminAnalysis" required>${item.adminAnalysis || ""}</textarea></div><button class="button" type="submit">${icon("save")} Salvar análise</button></form>` : ""}
      </section>
    </div>
  `;
}

function renderClosings() {
  const admin = currentUser()?.role === "admin";
  const divergentCycles = ["1", "2", "3", "4", "5", "6"].map(latestClosingCycle).filter((item) => item.status === "divergent");
  return `
    ${divergentCycles.length ? `<section class="panel alert-panel"><h2>Alerta de divergência</h2><p>${divergentCycles.map((item) => `Bomba ${item.pump}: diferença de ${formatNumber(item.diff)} litros`).join(" | ")}</p></section>` : ""}
    <section class="grid two">
      <form class="panel" data-form="closing">
        <div class="panel-header">
          <div>
            <h2>Novo encerrante</h2>
            <p>${admin ? "Administrador pode informar data e hora do encerrante." : "A data e hora serão registradas automaticamente pelo sistema."}</p>
          </div>
        </div>
        <div class="form-grid">
          <div class="field"><label>Data e hora</label>${admin ? `<input name="createdAt" type="datetime-local" value="${localDateTimeInput()}" required>` : `<input value="${formatDate(new Date().toISOString())}" readonly>`}</div>
          <div class="field"><label>Bomba</label><select name="pump" required>${pumpOptions()}</select></div>
          <div class="field"><label>Tipo de lançamento</label><select name="kind" required><option value="initial">Encerrante inicial</option><option value="final">Encerrante final</option></select></div>
          <div class="field"><label>Valor do encerrante</label><input name="value" type="text" inputmode="decimal" placeholder="Ex.: 85119,70" required></div>
          <div class="field full"><label>Foto do encerrante</label><input name="photo" type="file" accept="image/*" capture="environment" required></div>
          <div class="mobile-photo-preview hidden full" data-photo-preview-for="photo"></div>
        </div>
        <div class="actions" style="margin-top:14px"><button class="button" type="submit">${icon("save")} Salvar encerrante</button></div>
      </form>
      <div class="panel">
        <div class="panel-header">
          <div>
            <h2>Resumo por bomba</h2>
            <p>Baseado no último ciclo inicial/final de cada bomba. Tolerância: 1 litro.</p>
          </div>
        </div>
        ${renderPumpSummary()}
      </div>
    </section>
    ${renderClosingCycleList()}
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Lançamentos individuais</h2>
          <p>Registros de inicial e final lançados separadamente.</p>
        </div>
      </div>
    </section>
    <section class="table-wrap">
      <table>
        <thead><tr><th>Data</th><th>Hora</th><th>Bomba</th><th>Tipo</th><th>Valor</th><th>Foto</th><th>Usuário</th><th>Ações</th></tr></thead>
        <tbody>${state.pumpClosings.slice().sort((a,b) => closingTime(b) - closingTime(a)).map((item) => `<tr>
          <td>${item.date.split("-").reverse().join("/")}</td>
          <td>${formatDate(item.createdAt).split(", ")[1] || "-"}</td>
          <td>${item.pump}</td>
          <td>${closingKindLabel(item)}</td>
          <td>${formatNumber(closingValue(item))}</td>
          <td>${item.photo ? `<a href="${item.photo}" target="_blank" rel="noopener">Ver foto</a>` : "-"}</td>
          <td>${userById(item.userId)?.name || "-"}</td>
          <td>${admin ? `<button class="icon-btn" data-action="edit-closing" data-id="${item.id}" title="Editar">${icon("edit")}</button>` : "-"}</td>
        </tr>`).join("") || `<tr><td colspan="8">Nenhum encerrante lançado.</td></tr>`}</tbody>
      </table>
    </section>
  `;
}

function renderVehicles() {
  const admin = currentUser().role === "admin";
  return `
    ${admin ? `<section class="grid two">
      <form class="panel" data-form="vehicle">
        <div class="panel-header"><div><h2>Cadastrar veículo</h2><p>Defina a faixa esperada de km/l para classificar os alertas.</p></div></div>
        <div class="form-grid">
          <div class="field"><label>Prefixo</label><input name="code" required></div>
          <div class="field"><label>Descrição / placa</label><input name="plate" required></div>
          <div class="field"><label>Média mínima km/l</label><input name="minAvg" type="number" step="0.01" min="0.01" required></div>
          <div class="field"><label>Média máxima km/l</label><input name="maxAvg" type="number" step="0.01" min="0.01" required></div>
        </div>
        <div class="actions" style="margin-top:14px"><button class="button" type="submit">${icon("plus")} Cadastrar veículo</button></div>
      </form>
      <form class="panel" data-form="vehicles-bulk">
        <div class="panel-header"><div><h2>Cadastro em massa</h2><p>Cole uma linha por veículo: prefixo; descrição; média mínima; média máxima.</p></div></div>
        <div class="field">
          <label>Lista de veículos</label>
          <textarea name="vehiclesBulk" required placeholder="1201; Ônibus 1201; 2,15; 2,85&#10;1410; Ônibus 1410; 2,25; 3,05"></textarea>
        </div>
        <p class="status-line">Também aceita colunas copiadas do Excel: Prefixo | Descrição | Mínima | Máxima.</p>
        <div class="actions" style="margin-top:14px">
          <button class="button" type="submit">${icon("plus")} Importar veículos</button>
          <button class="button secondary" type="button" data-action="bulk-example">Exemplo</button>
        </div>
      </form>
    </section>` : ""}
    <section class="table-wrap">
      <table>
        <thead><tr><th>Prefixo</th><th>Descrição</th><th>Faixa km/l</th><th>Status</th><th>Último km</th></tr></thead>
        <tbody>${state.vehicles.map((vehicle) => {
          const last = state.fuelings.filter((item) => item.vehicleId === vehicle.id).sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
          return `<tr><td>${vehicle.code}</td><td>${vehicle.plate}</td><td>${formatNumber(vehicle.minAvg)} a ${formatNumber(vehicle.maxAvg)}</td><td><span class="badge ${vehicle.active ? "ok" : "warn"}">${vehicle.active ? "Ativo" : "Inativo"}</span></td><td>${last ? moneyless(last.km) : "-"}</td></tr>`;
        }).join("")}</tbody>
      </table>
    </section>
  `;
}

function renderUsers() {
  return `
    <form class="panel" data-form="user">
      <div class="panel-header"><div><h2>Cadastrar usuário</h2><p>Somente administradores podem criar acessos.</p></div></div>
      <div class="form-grid">
        <div class="field"><label>Nome</label><input name="name" required></div>
        <div class="field"><label>E-mail</label><input name="email" type="email" required></div>
        <div class="field"><label>Senha inicial</label><input name="password" type="text" required></div>
        <div class="field"><label>Perfil</label><select name="role" required><option value="frentista">Frentista</option><option value="admin">Administrador</option></select></div>
      </div>
      <div class="actions" style="margin-top:14px"><button class="button" type="submit">${icon("plus")} Criar usuário</button></div>
    </form>
    <section class="table-wrap">
      <table>
        <thead><tr><th>Nome</th><th>E-mail</th><th>Perfil</th><th>Status</th><th>Ações</th></tr></thead>
        <tbody>${state.users.map((user) => `<tr><td>${user.name}</td><td>${user.email}</td><td>${user.role}</td><td><span class="badge ${user.active ? "ok" : "warn"}">${user.active ? "Ativo" : "Inativo"}</span></td><td><button class="icon-btn" data-action="edit-user" data-id="${user.id}" title="Editar usuário">${icon("edit")}</button></td></tr>`).join("")}</tbody>
      </table>
    </section>
  `;
}

function renderEditUserModal() {
  if (!editUserId) return "";
  const user = state.users.find((item) => item.id === editUserId);
  if (!user) return "";
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <form class="modal compact" data-form="edit-user">
        <div class="panel-header">
          <div>
            <h2>Editar usuário</h2>
            <p>Atualize cadastro, perfil, status ou defina uma nova senha.</p>
          </div>
          <button class="icon-btn" type="button" data-action="cancel-edit-user" title="Fechar">${icon("close")}</button>
        </div>
        <div class="form-grid single">
          <div class="field"><label>Nome</label><input name="name" value="${user.name}" required></div>
          <div class="field"><label>E-mail</label><input name="email" type="email" value="${user.email}" required></div>
          <div class="field"><label>Perfil</label><select name="role" required><option value="frentista" ${user.role === "frentista" ? "selected" : ""}>Frentista</option><option value="admin" ${user.role === "admin" ? "selected" : ""}>Administrador</option></select></div>
          <div class="field"><label>Status</label><select name="active" required><option value="true" ${user.active ? "selected" : ""}>Ativo</option><option value="false" ${!user.active ? "selected" : ""}>Inativo</option></select></div>
          <div class="field"><label>Nova senha</label><input name="password" type="text" placeholder="Preencha apenas se quiser trocar"></div>
        </div>
        <div class="actions" style="margin-top:14px">
          <button class="button" type="submit">${icon("save")} Salvar alterações</button>
          <button class="button secondary" type="button" data-action="cancel-edit-user">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function renderChangePasswordModal() {
  if (!showChangePassword) return "";
  return `
    <div class="modal-backdrop" role="dialog" aria-modal="true">
      <form class="modal compact" data-form="change-password">
        <div class="panel-header">
          <div>
            <h2>Trocar senha</h2>
            <p>Informe a senha atual e defina uma nova senha de acesso.</p>
          </div>
          <button class="icon-btn" type="button" data-action="cancel-change-password" title="Fechar">${icon("close")}</button>
        </div>
        <div class="form-grid single">
          <div class="field"><label>Senha atual</label><input name="currentPassword" type="password" autocomplete="current-password" required></div>
          <div class="field"><label>Nova senha</label><input name="newPassword" type="password" autocomplete="new-password" minlength="6" required></div>
          <div class="field"><label>Confirmar nova senha</label><input name="confirmPassword" type="password" autocomplete="new-password" minlength="6" required></div>
        </div>
        <div class="actions" style="margin-top:14px">
          <button class="button" type="submit">${icon("save")} Salvar nova senha</button>
          <button class="button secondary" type="button" data-action="cancel-change-password">Cancelar</button>
        </div>
      </form>
    </div>
  `;
}

function vehicleOptions(selected = "", query = "") {
  const normalized = query.trim().toLowerCase();
  return state.vehicles
    .filter((item) => item.active)
    .filter((item) => !normalized || `${item.code} ${item.plate}`.toLowerCase().includes(normalized))
    .map((item) => `<option value="${item.id}" ${selected === item.id ? "selected" : ""}>${item.code} - ${item.plate}</option>`)
    .join("");
}

function vehicleSearchLabel(vehicle) {
  return `${vehicle.code} - ${vehicle.plate}`;
}

function vehicleSearchResults(query) {
  const normalized = String(query || "").trim().toLowerCase();
  return state.vehicles
    .filter((item) => item.active)
    .filter((item) => !normalized || vehicleSearchLabel(item).toLowerCase().includes(normalized))
    .slice(0, 8);
}

function vehicleBySearchLabel(label) {
  const normalized = String(label || "").trim().toLowerCase();
  return state.vehicles.find((item) => item.active && vehicleSearchLabel(item).toLowerCase() === normalized);
}

function pumpOptions(selected = "") {
  return ["1", "2", "3", "4", "5", "6"].map((item) => `<option value="${item}" ${selected === item ? "selected" : ""}>Bomba ${item}</option>`).join("");
}

function bindEvents() {
  document.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => {
      route = button.dataset.route;
      if (route !== "fuelings") showFuelingForm = false;
      sidebarOpen = false;
      render();
    });
  });
  document.querySelectorAll("[data-action='toggle-menu']").forEach((button) => button.addEventListener("click", () => {
    sidebarOpen = !sidebarOpen;
    render();
  }));
  document.querySelectorAll("[data-action='logout']").forEach((button) => button.addEventListener("click", () => {
    currentUserId = "";
    sessionToken = "";
    saveState();
    renderLogin();
  }));
  document.querySelectorAll("[data-action='sync-offline']").forEach((button) => button.addEventListener("click", syncOfflineFuelings));
  document.querySelectorAll("[data-action='change-password']").forEach((button) => button.addEventListener("click", () => {
    showChangePassword = true;
    sidebarOpen = false;
    render();
  }));
  document.querySelectorAll("[data-action='cancel-change-password']").forEach((button) => button.addEventListener("click", () => {
    showChangePassword = false;
    render();
  }));
  document.querySelectorAll("[data-action='open-fueling']").forEach((button) => button.addEventListener("click", () => {
    route = "fuelings";
    showFuelingForm = true;
    sidebarOpen = false;
    render();
  }));
  document.querySelectorAll("[data-action='close-fueling']").forEach((button) => button.addEventListener("click", () => {
    showFuelingForm = false;
    render();
  }));
  document.querySelectorAll("[data-action='detail-fueling']").forEach((button) => button.addEventListener("click", () => {
    detailFuelingId = button.dataset.id;
    render();
  }));
  document.querySelectorAll("[data-action='close-detail']").forEach((button) => button.addEventListener("click", () => {
    detailFuelingId = "";
    render();
  }));
  document.querySelectorAll("[data-action='request-delete-fueling']").forEach((button) => button.addEventListener("click", () => {
    deleteTargetId = button.dataset.id;
    detailFuelingId = "";
    editFuelingId = "";
    render();
  }));
  document.querySelectorAll("[data-action='cancel-delete-fueling']").forEach((button) => button.addEventListener("click", () => {
    deleteTargetId = "";
    render();
  }));
  document.querySelectorAll("[data-action='edit-fueling']").forEach((button) => button.addEventListener("click", () => {
    editFuelingId = button.dataset.id;
    detailFuelingId = "";
    deleteTargetId = "";
    render();
  }));
  document.querySelectorAll("[data-action='cancel-edit-fueling']").forEach((button) => button.addEventListener("click", () => {
    editFuelingId = "";
    render();
  }));
  document.querySelectorAll("[data-action='edit-closing']").forEach((button) => button.addEventListener("click", () => {
    editClosingId = button.dataset.id;
    render();
  }));
  document.querySelectorAll("[data-action='cancel-edit-closing']").forEach((button) => button.addEventListener("click", () => {
    editClosingId = "";
    render();
  }));
  document.querySelectorAll("[data-action='view-closing-photo']").forEach((button) => button.addEventListener("click", () => {
    const item = state.pumpClosings.find((closing) => closing.id === button.dataset.id);
    if (!item?.photo) return toast("Foto não encontrada para este encerrante.");
    closingPhotoPreview = { id: item.id, kind: closingKind(item) };
    render();
  }));
  document.querySelectorAll("[data-action='close-closing-photo']").forEach((button) => button.addEventListener("click", () => {
    closingPhotoPreview = null;
    render();
  }));
  document.querySelectorAll("[data-action='edit-user']").forEach((button) => button.addEventListener("click", () => {
    editUserId = button.dataset.id;
    render();
  }));
  document.querySelectorAll("[data-action='cancel-edit-user']").forEach((button) => button.addEventListener("click", () => {
    editUserId = "";
    render();
  }));
  document.querySelectorAll("[data-action='export']").forEach((button) => button.addEventListener("click", exportFuelings));
  document.querySelectorAll("[data-action='export-txt-erp']").forEach((button) => button.addEventListener("click", exportFuelingsTxtErp));
  document.querySelectorAll("[data-sort]").forEach((button) => button.addEventListener("click", () => {
    const key = button.dataset.sort;
    fuelingsSort = {
      key,
      direction: fuelingsSort.key === key && fuelingsSort.direction === "asc" ? "desc" : "asc",
    };
    render();
  }));
  document.querySelectorAll("[data-filter-box] input, [data-filter-box] select").forEach((input) => input.addEventListener("change", () => {
    filters[input.name] = input.value;
    render();
  }));
  document.querySelectorAll("[data-closing-filter] input, [data-closing-filter] select").forEach((input) => input.addEventListener("change", () => {
    closingFilters[input.name] = input.value;
    render();
  }));
  document.querySelector("[data-form='login']")?.addEventListener("submit", onLogin);
  document.querySelector("[data-form='fueling']")?.addEventListener("submit", onFueling);
  document.querySelector("[data-form='fueling']")?.addEventListener("input", previewFueling);
  document.querySelector("[data-form='edit-fueling']")?.addEventListener("submit", onEditFueling);
  document.querySelector("[data-form='delete-fueling']")?.addEventListener("submit", onDeleteFueling);
  document.querySelector("[data-form='edit-user']")?.addEventListener("submit", onEditUser);
  document.querySelector("[data-form='change-password']")?.addEventListener("submit", onChangePassword);
  document.querySelector("[data-form='vehicle']")?.addEventListener("submit", onVehicle);
  document.querySelector("[data-form='vehicles-bulk']")?.addEventListener("submit", onVehiclesBulk);
  document.querySelector("[data-action='bulk-example']")?.addEventListener("click", fillBulkVehicleExample);
  document.querySelector("[data-form='user']")?.addEventListener("submit", onUser);
  document.querySelector("[data-form='closing']")?.addEventListener("submit", onClosing);
  document.querySelector("[data-form='edit-closing']")?.addEventListener("submit", onEditClosing);
  document.querySelectorAll("[data-diesel-view]").forEach((button) => button.addEventListener("click", () => {
    dieselReceivingView = button.dataset.dieselView;
    dieselReceivingDetailId = "";
    render();
  }));
  document.querySelector("[data-form='diesel-receipt']")?.addEventListener("submit", onDieselReceipt);
  document.querySelector("[data-form='diesel-receipt']")?.addEventListener("input", updateDieselReceiptPreview);
  document.querySelector("[data-form='diesel-receipt']")?.addEventListener("change", updateDieselReceiptPreview);
  document.querySelector("[data-form='diesel-tank']")?.addEventListener("submit", onDieselTank);
  document.querySelector("[data-form='diesel-arqueacao']")?.addEventListener("submit", onDieselArqueacao);
  document.querySelector("[data-form='diesel-tolerance']")?.addEventListener("submit", onDieselTolerance);
  document.querySelector("[data-form='diesel-analysis']")?.addEventListener("submit", onDieselAnalysis);
  document.querySelectorAll("[data-form='diesel-receipt'] select[name='company'], [data-form='diesel-arqueacao'] select[name='company'], [data-form='diesel-tolerance'] select[name='company']").forEach((select) => {
    select.addEventListener("change", () => {
      const tankSelect = select.closest("form").querySelector("select[name='tankId']");
      if (tankSelect) tankSelect.innerHTML = `<option value="">Selecione</option>${tankOptions(select.value)}`;
      if (select.closest("form").matches("[data-form='diesel-receipt']")) updateDieselReceiptPreview({ currentTarget: select.closest("form") });
    });
  });
  document.querySelectorAll("[data-action='diesel-detail']").forEach((button) => button.addEventListener("click", () => {
    dieselReceivingDetailId = button.dataset.id;
    render();
  }));
  document.querySelectorAll("[data-action='close-diesel-detail']").forEach((button) => button.addEventListener("click", () => {
    dieselReceivingDetailId = "";
    render();
  }));
  document.querySelectorAll("[data-diesel-filter] input, [data-diesel-filter] select").forEach((input) => input.addEventListener("change", () => {
    dieselReceivingFilters[input.name] = input.value;
    render();
  }));
  document.querySelector("[data-action='export-diesel-receipts']")?.addEventListener("click", exportDieselReceipts);
  bindVehicleSearches();
  bindFuelingPhotoFlow();
}

function bindVehicleSearches() {
  document.querySelectorAll("[data-vehicle-search]").forEach((input) => {
    const hidden = input.parentElement.querySelector("input[name='vehicleId']");
    const suggestions = input.parentElement.querySelector("[data-vehicle-suggestions]");
    const form = input.closest("form");
    const renderSuggestions = () => {
      const results = vehicleSearchResults(input.value);
      suggestions.innerHTML = results.length
        ? results.map((vehicle) => `<button type="button" data-vehicle-option="${vehicle.id}">${vehicleSearchLabel(vehicle)}</button>`).join("")
        : `<div class="vehicle-suggestion-empty">Nenhum veículo encontrado.</div>`;
      suggestions.classList.remove("hidden");
      suggestions.querySelectorAll("[data-vehicle-option]").forEach((button) => {
        button.addEventListener("mousedown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          const vehicle = vehicleById(button.dataset.vehicleOption);
          if (!vehicle) return;
          input.value = vehicleSearchLabel(vehicle);
          hidden.value = vehicle.id;
          input.setCustomValidity("");
          updateFuelingKmGuidance(form);
          suggestions.classList.add("hidden");
          input.blur();
        });
      });
    };
    const syncVehicle = () => {
      const vehicle = vehicleBySearchLabel(input.value);
      hidden.value = vehicle?.id || "";
      input.setCustomValidity(input.value && !vehicle ? "Selecione um veículo válido da lista." : "");
      updateFuelingKmGuidance(form);
    };
    input.addEventListener("input", () => {
      syncVehicle();
      renderSuggestions();
    });
    input.addEventListener("focus", renderSuggestions);
    input.addEventListener("blur", () => setTimeout(() => suggestions.classList.add("hidden"), 140));
    input.addEventListener("change", syncVehicle);
    syncVehicle();
    updateFuelingKmGuidance(form);
  });
}

function bindFuelingPhotoFlow() {
  const forms = [
    { form: document.querySelector("[data-form='fueling']"), names: ["vehiclePhoto", "tachographPhoto", "pumpPhoto"] },
    { form: document.querySelector("[data-form='closing']"), names: ["photo"] },
    { form: document.querySelector("[data-form='edit-closing']"), names: ["photo"] },
  ];
  forms.forEach(({ form, names }) => {
    if (!form) return;
    names.forEach((name) => {
    const input = form.querySelector(`input[name='${name}']`);
    const preview = form.querySelector(`[data-photo-preview-for='${name}']`);
    const nextField = form.querySelector(`[data-after-photo='${name}']`);
    const nextInput = nextField?.querySelector("input");
    if (!input || !preview) return;

    input.addEventListener("change", () => {
      const file = input.files?.[0];
      preview.querySelector("img")?.dataset.objectUrl && URL.revokeObjectURL(preview.querySelector("img").dataset.objectUrl);
      if (!file) {
        preview.innerHTML = "";
        preview.classList.add("hidden");
        if (nextField && nextInput) {
          nextField.classList.add("hidden");
          nextInput.disabled = true;
          nextInput.value = "";
          if (name === "tachographPhoto") updateFuelingKmGuidance(form);
        }
        return;
      }

      const objectUrl = URL.createObjectURL(file);
      preview.innerHTML = `<img src="${objectUrl}" alt="Foto capturada" data-object-url="${objectUrl}">`;
      preview.classList.remove("hidden");
      if (nextField && nextInput) {
        nextField.classList.remove("hidden");
        nextInput.disabled = false;
        if (name === "tachographPhoto") updateFuelingKmGuidance(form);
        setTimeout(() => nextInput.focus(), 120);
      }
    });
  });
  });
}

async function onLogin(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const payload = await apiRequest("/login", {
      method: "POST",
      body: JSON.stringify({ email: data.email, password: data.password }),
    });
    sessionToken = payload.token;
    currentUserId = payload.user.id;
    applyRemoteData(payload.data);
    saveState();
    route = "dashboard";
    render();
    syncOfflineFuelings();
  } catch (error) {
    toast(error.message);
  }
}

function canvasToDataUrl(canvas, quality = 0.78) {
  return canvas.toDataURL("image/jpeg", quality);
}

async function imageFileToBitmap(file) {
  if ("createImageBitmap" in window) {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      return createImageBitmap(file);
    }
  }

  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = URL.createObjectURL(file);
  });
}

async function fileToDataUrl(file) {
  if (!file || !file.size) return "";

  if (!file.type.startsWith("image/")) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  const source = await imageFileToBitmap(file);
  const sourceWidth = source.width;
  const sourceHeight = source.height;
  const maxSide = 1600;
  const scale = Math.min(1, maxSide / Math.max(sourceWidth, sourceHeight));
  const width = Math.max(1, Math.round(sourceWidth * scale));
  const height = Math.max(1, Math.round(sourceHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { alpha: false });
  context.fillStyle = "#fff";
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0, width, height);

  if ("close" in source) source.close();
  return canvasToDataUrl(canvas);
}

async function onFueling(event) {
  event.preventDefault();
  if (fuelingSubmitting) return;
  const form = event.currentTarget;
  const submitButton = form.querySelector("button[type='submit']");
  const data = Object.fromEntries(new FormData(form));
  if (!form.reportValidity()) return;
  const lastFueling = latestFuelingForVehicle(data.vehicleId);
  if (lastFueling && Number(data.km) < Number(lastFueling.km)) {
    const confirmed = window.confirm(`O km informado (${moneyless(data.km)}) é menor que o último km lançado para este veículo (${moneyless(lastFueling.km)} em ${formatDate(lastFueling.createdAt)}).\n\nConfirma salvar este abastecimento mesmo assim?`);
    if (!confirmed) return;
  }
  fuelingSubmitting = true;
  if (submitButton) {
    submitButton.disabled = true;
    submitButton.innerHTML = `${icon("save")} Salvando...`;
  }
  let requestPayload = null;
  try {
    const vehiclePhoto = await fileToDataUrl(form.vehiclePhoto.files[0]);
    const tachographPhoto = await fileToDataUrl(form.tachographPhoto.files[0]);
    const pumpPhoto = await fileToDataUrl(form.pumpPhoto.files[0]);
    requestPayload = {
      source: "online",
      vehicleId: data.vehicleId,
      vehiclePhoto,
      tachographPhoto,
      pump: data.pump,
      pumpPhoto,
      km: Number(data.km),
      liters: Number(data.liters),
      observation: data.observation || "",
    };
    const payload = await apiRequest("/fuelings", {
      method: "POST",
      body: JSON.stringify(requestPayload),
    });
    state.fuelings.unshift(payload.fueling);
    const status = consumptionStatus(payload.fueling);
    toast(status.key === "ok" || status.key === "info" ? "Lançamento salvo com sucesso." : `Lançamento salvo com alerta: ${status.label}.`);
    route = "fuelings";
    showFuelingForm = false;
    fuelingSubmitting = false;
    render();
  } catch (error) {
    if (error.network || error.status === 401) {
      try {
        if (!requestPayload) {
          const vehiclePhoto = await fileToDataUrl(form.vehiclePhoto.files[0]);
          const tachographPhoto = await fileToDataUrl(form.tachographPhoto.files[0]);
          const pumpPhoto = await fileToDataUrl(form.pumpPhoto.files[0]);
          requestPayload = {
            source: "online",
            vehicleId: data.vehicleId,
            vehiclePhoto,
            tachographPhoto,
            pump: data.pump,
            pumpPhoto,
            km: Number(data.km),
            liters: Number(data.liters),
            observation: data.observation || "",
          };
        }
        await enqueueOfflineFueling(requestPayload);
        route = "fuelings";
        showFuelingForm = false;
        fuelingSubmitting = false;
        if (error.status === 401) {
          clearSession();
          renderLogin();
          toast("Sessão expirada. Lançamento salvo como pendente. Entre novamente para sincronizar.");
        } else {
          toast("Sem conexão. Lançamento salvo como pendente para sincronizar depois.");
          render();
        }
        return;
      } catch (offlineError) {
        toast("Não foi possível salvar offline neste aparelho.");
      }
    }
    fuelingSubmitting = false;
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.innerHTML = `${icon("save")} Salvar lançamento`;
    }
    toast(error.message);
  }
}

async function onDeleteFueling(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const id = deleteTargetId;
  if (!id) return;
  try {
    await apiRequest(`/fuelings/${encodeURIComponent(id)}`, {
      method: "DELETE",
      body: JSON.stringify({ password: data.password }),
    });
    state.fuelings = state.fuelings.filter((item) => item.id !== id);
    deleteTargetId = "";
    toast("Abastecimento excluído.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function onEditFueling(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const id = editFuelingId;
  if (!id) return;
  try {
    const payload = await apiRequest(`/fuelings/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        vehicleId: data.vehicleId,
        pump: data.pump,
        km: Number(data.km),
        liters: Number(data.liters),
        observation: data.observation || "",
        justification: data.justification,
        password: data.password,
      }),
    });
    state.fuelings = state.fuelings.map((item) => item.id === id ? payload.fueling : item);
    state.fuelingAudits = [payload.audit, ...(state.fuelingAudits || [])].filter(Boolean);
    saveState();
    editFuelingId = "";
    toast("Abastecimento alterado com histórico registrado.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

function updateFuelingKmGuidance(form) {
  if (!form) return;
  const guidance = form.querySelector("[data-km-guidance]");
  if (!guidance) return;
  const vehicleId = form.querySelector("input[name='vehicleId']")?.value || "";
  const kmValue = form.querySelector("input[name='km']")?.value || "";
  const litersValue = form.querySelector("input[name='liters']")?.value || "";
  const last = latestFuelingForVehicle(vehicleId);
  if (!vehicleId) {
    guidance.textContent = "";
    return;
  }
  if (!last) {
    guidance.textContent = "Sem abastecimento anterior registrado para este veículo.";
    return;
  }
  const parts = [`<div>Último km lançado: <strong>${moneyless(last.km)}</strong> em ${formatDate(last.createdAt)}.</div>`];
  const hasKm = kmValue !== "";
  const hasLiters = litersValue !== "";
  if (hasKm) {
    const distance = Number(kmValue) - Number(last.km);
    parts.push(`<div class="km-preview-line">Km rodado prévio: <strong>${moneyless(distance)}</strong>.</div>`);
    if (hasLiters && Number(litersValue) > 0) {
      const ghost = { id: "preview", createdAt: new Date().toISOString(), vehicleId, km: Number(kmValue), liters: Number(litersValue) };
      const status = consumptionStatus(ghost);
      const average = distance > 0 ? distance / Number(litersValue) : 0;
      parts.push(`<div class="km-preview-line">Média prévia: <strong>${formatNumber(average)} km/l</strong> <span class="badge ${status.className}">${status.label}</span></div>`);
    } else {
      parts.push(`<div class="km-preview-line">Informe os litros para calcular a média prévia.</div>`);
    }
  }
  guidance.innerHTML = parts.join("");
  if (hasKm && Number(kmValue) < Number(last.km)) {
    guidance.innerHTML += `<div class="km-alert">Atenção: km informado inferior ao último km lançado.</div>`;
  }
}

function previewFueling(event) {
  const form = event.currentTarget;
  updateFuelingKmGuidance(form);
  const preview = form.querySelector("[data-live-preview]");
  if (preview) preview.textContent = "";
}

async function onVehicle(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (Number(data.minAvg) >= Number(data.maxAvg)) {
    toast("A média mínima precisa ser menor que a máxima.");
    return;
  }
  try {
    const payload = await apiRequest("/vehicles", {
      method: "POST",
      body: JSON.stringify({ code: data.code.trim(), plate: data.plate.trim(), minAvg: Number(data.minAvg), maxAvg: Number(data.maxAvg) }),
    });
    state.vehicles.push(payload.vehicle);
    state.vehicles.sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
    toast("Veículo cadastrado.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

function parseLocaleNumber(value) {
  const text = String(value || "").trim().replace(/\s/g, "");
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

function decimalInputValue(value) {
  return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function splitBulkVehicleLine(line) {
  if (line.includes("\t")) return line.split("\t");
  if (line.includes(";")) return line.split(";");
  return line.split(",");
}

function parseBulkVehicles(text) {
  const existingCodes = new Set(state.vehicles.map((vehicle) => vehicle.code.trim().toLowerCase()));
  const seenCodes = new Set();
  const imported = [];
  const errors = [];
  const duplicates = [];

  text.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    if (!line) return;

    const parts = splitBulkVehicleLine(line).map((part) => part.trim());
    const [code, plate, minAvgRaw, maxAvgRaw] = parts;
    const lineNumber = index + 1;

    if (parts.length < 4 || !code || !plate) {
      errors.push(`Linha ${lineNumber}: informe prefixo, descrição, média mínima e média máxima.`);
      return;
    }

    const normalizedCode = code.toLowerCase();
    if (existingCodes.has(normalizedCode) || seenCodes.has(normalizedCode)) {
      duplicates.push(code);
      return;
    }

    const minAvg = parseLocaleNumber(minAvgRaw);
    const maxAvg = parseLocaleNumber(maxAvgRaw);
    if (!Number.isFinite(minAvg) || !Number.isFinite(maxAvg) || minAvg <= 0 || maxAvg <= 0 || minAvg >= maxAvg) {
      errors.push(`Linha ${lineNumber}: faixa de média inválida.`);
      return;
    }

    seenCodes.add(normalizedCode);
    imported.push({ id: uid("v"), code, plate, minAvg, maxAvg, active: true });
  });

  return { imported, errors, duplicates };
}

async function onVehiclesBulk(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  const result = parseBulkVehicles(data.vehiclesBulk);

  if (result.errors.length) {
    toast(result.errors.slice(0, 2).join(" "));
    return;
  }

  if (!result.imported.length) {
    toast(result.duplicates.length ? "Nenhum veículo novo para importar. Prefixos duplicados foram ignorados." : "Informe pelo menos um veículo válido.");
    return;
  }

  try {
    const payload = await apiRequest("/vehicles/bulk", {
      method: "POST",
      body: JSON.stringify({ vehicles: result.imported.map(({ code, plate, minAvg, maxAvg }) => ({ code, plate, minAvg, maxAvg })) }),
    });
    state.vehicles.push(...payload.vehicles);
    state.vehicles.sort((a, b) => a.code.localeCompare(b.code, "pt-BR", { numeric: true }));
    const duplicateText = result.duplicates.length ? ` ${result.duplicates.length} duplicado(s) ignorado(s).` : "";
    toast(`${payload.vehicles.length} veículo(s) importado(s).${duplicateText}`);
    render();
  } catch (error) {
    toast(error.message);
  }
}

function fillBulkVehicleExample() {
  const textarea = document.querySelector("[name='vehiclesBulk']");
  if (!textarea) return;
  textarea.value = [
    "2101; Ônibus 2101; 2,20; 2,90",
    "2102; Ônibus 2102; 2,20; 2,90",
    "3101; Micro 3101; 3,40; 4,40",
  ].join("\n");
  textarea.focus();
}

async function onUser(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (state.users.some((user) => user.email.toLowerCase() === data.email.toLowerCase())) {
    toast("Já existe usuário com esse e-mail.");
    return;
  }
  try {
    const payload = await apiRequest("/users", {
      method: "POST",
      body: JSON.stringify({ name: data.name.trim(), email: data.email.trim(), password: data.password, role: data.role }),
    });
    state.users.push(payload.user);
    toast("Usuário criado.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function onEditUser(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const id = editUserId;
  if (!id) return;
  const email = data.email.trim();
  if (state.users.some((user) => user.id !== id && user.email.toLowerCase() === email.toLowerCase())) {
    toast("Já existe outro usuário com esse e-mail.");
    return;
  }
  try {
    const payload = await apiRequest(`/users/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({
        name: data.name.trim(),
        email,
        role: data.role,
        active: data.active === "true",
        password: data.password || "",
      }),
    });
    state.users = state.users.map((user) => user.id === id ? payload.user : user);
    if (id === currentUserId) currentUserId = payload.user.id;
    editUserId = "";
    toast("Usuário atualizado.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function onChangePassword(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  if (data.newPassword !== data.confirmPassword) {
    toast("A confirmação da nova senha não confere.");
    return;
  }
  if (String(data.newPassword).length < 6) {
    toast("A nova senha precisa ter pelo menos 6 caracteres.");
    return;
  }
  try {
    await apiRequest("/me/password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: data.currentPassword,
        newPassword: data.newPassword,
      }),
    });
    showChangePassword = false;
    toast("Senha alterada com sucesso.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function onClosing(event) {
  event.preventDefault();
  const isAdmin = currentUser()?.role === "admin";
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  if (!form.reportValidity()) return;
  const value = parseLocaleNumber(data.value);
  const createdAt = isAdmin && data.createdAt ? new Date(data.createdAt).toISOString() : new Date().toISOString();
  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) {
    toast("Informe uma data e hora válida.");
    return;
  }
  if (!Number.isFinite(value) || value < 0) {
    toast("Informe um valor de encerrante válido.");
    return;
  }
  const photo = await fileToDataUrl(form.photo.files[0]);
  if (!photo) {
    toast("A foto do encerrante é obrigatória.");
    return;
  }
  try {
    const payload = await apiRequest("/closings", {
      method: "POST",
      body: JSON.stringify({ ...(isAdmin ? { createdAt } : {}), pump: data.pump, kind: data.kind, value, photo }),
    });
    state.pumpClosings.unshift(payload.closing);
    const cycle = latestClosingCycle(data.pump);
    const message = cycle.status === "pending"
      ? `${data.kind === "final" ? "Encerrante final" : "Encerrante inicial"} salvo. Aguardando o outro lançamento para conciliar.`
      : cycle.status === "divergent"
      ? `Alerta de divergência na bomba ${data.pump}: diferença de ${formatNumber(cycle.diff)} litros.`
      : `${data.kind === "final" ? "Encerrante final" : "Encerrante inicial"} salvo. ${cycle.rolledOver ? "Encerrante virou em 100.000,00. " : ""}Diferença da bomba ${data.pump}: ${formatNumber(cycle.diff)} litros.`;
    toast(message);
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function onEditClosing(event) {
  event.preventDefault();
  if (currentUser()?.role !== "admin") {
    toast("Apenas administradores podem editar encerrantes.");
    return;
  }
  const id = editClosingId;
  const existing = state.pumpClosings.find((item) => item.id === id);
  if (!id || !existing) return;
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  if (!form.reportValidity()) return;
  const value = parseLocaleNumber(data.value);
  const createdAt = data.createdAt ? new Date(data.createdAt).toISOString() : new Date().toISOString();
  const createdTime = new Date(createdAt).getTime();
  if (!Number.isFinite(createdTime)) {
    toast("Informe uma data e hora válida.");
    return;
  }
  if (!Number.isFinite(value) || value < 0) {
    toast("Informe um valor de encerrante válido.");
    return;
  }
  try {
    const photo = form.photo.files[0] ? await fileToDataUrl(form.photo.files[0]) : "";
    const payload = await apiRequest(`/closings/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ createdAt, pump: data.pump, kind: data.kind, value, photo }),
    });
    state.pumpClosings = state.pumpClosings.map((item) => item.id === id ? payload.closing : item);
    editClosingId = "";
    const cycle = latestClosingCycle(data.pump);
    toast(cycle.status === "divergent" ? `Encerrante alterado com alerta: diferença de ${formatNumber(cycle.diff)} litros.` : `Encerrante alterado.${cycle.rolledOver ? " Virada em 100.000,00 considerada." : ""}`);
    render();
  } catch (error) {
    toast(error.message);
  }
}

function parseDieselArqueacaoRows(text, company, tankId) {
  return String(text || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
    const [measureMm, liters] = (line.includes(";") ? line.split(";") : line.split(/\t|,/)).map((part) => part.trim());
    return { company, tankId, measureMm: parseLocaleNumber(measureMm), liters: parseLocaleNumber(liters), active: true };
  }).filter((item) => Number.isFinite(item.measureMm) && Number.isFinite(item.liters));
}

async function onDieselReceipt(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const data = Object.fromEntries(new FormData(form));
  if (Number(data.finalMm) < Number(data.initialMm)) return toast("Medição final não pode ser menor que a inicial.");
  if (Number(data.invoiceLiters) <= 0) return toast("Quantidade da nota precisa ser maior que zero.");
  try {
    const payload = await apiRequest("/diesel-receiving/receipts", {
      method: "POST",
      body: JSON.stringify({
        company: data.company,
        tankId: data.tankId,
        receivedAt: new Date(data.receivedAt).toISOString(),
        trailerPlate: data.trailerPlate,
        supplier: data.supplier,
        invoiceNumber: data.invoiceNumber,
        invoiceLiters: Number(data.invoiceLiters),
        sealedTruckPhoto: await fileToDataUrl(form.sealedTruckPhoto.files[0]),
        initialMm: Number(data.initialMm),
        initialPhoto: await fileToDataUrl(form.initialPhoto.files[0]),
        finalMm: Number(data.finalMm),
        finalPhoto: await fileToDataUrl(form.finalPhoto.files[0]),
        observation: data.observation || "",
      }),
    });
    dieselReceivingData.receipts.unshift(payload.receipt);
    toast(`Recebimento salvo: ${payload.receipt.status}.`);
    dieselReceivingView = "report";
    render();
  } catch (error) {
    toast(error.message);
  }
}

function updateDieselReceiptPreview(event) {
  const form = event.currentTarget?.matches?.("[data-form='diesel-receipt']") ? event.currentTarget : document.querySelector("[data-form='diesel-receipt']");
  if (!form) return;
  const preview = form.querySelector("[data-diesel-preview]");
  if (!preview) return;
  const data = Object.fromEntries(new FormData(form));
  preview.innerHTML = renderDieselSimulationPreview(simulateDieselReceipt(data));
}

async function onDieselTank(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const payload = await apiRequest("/diesel-receiving/tanks", {
      method: "POST",
      body: JSON.stringify({ company: data.company, name: data.name, code: data.code, fuelType: data.fuelType, nominalCapacity: Number(data.nominalCapacity), realCapacity: Number(data.realCapacity), heightMm: Number(data.heightMm), diameter: Number(data.diameter), active: true }),
    });
    dieselReceivingData.tanks.push(payload.tank);
    toast("Tanque cadastrado.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function onDieselArqueacao(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  const items = parseDieselArqueacaoRows(data.rows, data.company, data.tankId);
  if (!items.length) return toast("Informe pelo menos uma linha válida.");
  try {
    const payload = await apiRequest("/diesel-receiving/arqueacao", { method: "POST", body: JSON.stringify({ items }) });
    dieselReceivingData.arqueacao.push(...payload.arqueacao);
    toast(`${payload.arqueacao.length} linha(s) importada(s).`);
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function onDieselTolerance(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const payload = await apiRequest("/diesel-receiving/tolerances", {
      method: "POST",
      body: JSON.stringify({ company: data.company, tankId: data.tankId, toleranceLiters: Number(data.toleranceLiters), tolerancePercent: Number(data.tolerancePercent), active: true }),
    });
    dieselReceivingData.tolerances.unshift(payload.tolerance);
    toast("Tolerância cadastrada.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

async function onDieselAnalysis(event) {
  event.preventDefault();
  const data = Object.fromEntries(new FormData(event.currentTarget));
  try {
    const payload = await apiRequest(`/diesel-receiving/receipts/${encodeURIComponent(dieselReceivingDetailId)}/analyze`, {
      method: "PUT",
      body: JSON.stringify({ adminAnalysis: data.adminAnalysis }),
    });
    dieselReceivingData.receipts = dieselReceivingData.receipts.map((item) => item.id === payload.receipt.id ? payload.receipt : item);
    toast("Análise salva.");
    render();
  } catch (error) {
    toast(error.message);
  }
}

function exportDieselReceipts() {
  const header = ["Data", "Empresa", "Tanque", "Fornecedor", "Placa", "Nota", "LitrosNF", "InicialLitros", "FinalLitros", "LitrosApurados", "DiferencaLitros", "DiferencaPercentual", "Status"];
  const rows = filteredDieselReceipts().map((item) => {
    const conversion = dieselReceiptConversion(item);
    return [formatDate(item.receivedAt), item.company, dieselReceivingData.tanks.find((tank) => tank.id === item.tankId)?.name || "", item.supplier, item.trailerPlate, item.invoiceNumber, item.invoiceLiters, conversion.initialLiters ?? "", conversion.finalLiters ?? "", conversion.measuredLiters ?? "", conversion.diffLiters ?? "", conversion.diffPercent === null ? "" : conversion.diffPercent * 100, item.status];
  });
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `recebimentos-diesel-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("Relatório exportado.");
}

function exportFuelings() {
  const header = ["DataHora", "Origem", "SincronizadoEm", "Veiculo", "KmAtual", "KmPercorrido", "Bomba", "Litros", "MediaKmL", "Status", "Frentista", "Observacao"];
  const rows = filteredFuelings().map((item) => {
    const data = consumption(item);
    const status = consumptionStatus(item);
    return [
      formatDate(item.createdAt),
      fuelingOriginLabel(item),
      item.syncedAt ? formatDate(item.syncedAt) : "",
      vehicleById(item.vehicleId)?.code || "",
      item.km,
      data ? data.distance : "",
      item.pump,
      String(item.liters).replace(".", ","),
      data ? String(data.average.toFixed(2)).replace(".", ",") : "",
      status.label,
      userById(item.userId)?.name || "",
      fuelingObservation(item),
    ];
  });
  const csv = [header, ...rows].map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `abastecimentos-bmtop-${today()}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("Arquivo exportado para Excel em CSV.");
}

function fixedText(value, width, align = "left", fill = " ") {
  const text = String(value ?? "");
  if (text.length >= width) return text.slice(0, width);
  return align === "right" ? text.padStart(width, fill) : text.padEnd(width, fill);
}

function onlyDigits(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function erpDateParts(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return { date: "00/00/0000", time: "00:00:00" };
  const pad = (number) => String(number).padStart(2, "0");
  return {
    date: `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`,
    time: `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`,
  };
}

function erpDecimalCents(value) {
  return fixedText(Math.round(Number(value || 0) * 100), 10, "right", "0");
}

function erpInteger(value, width) {
  return fixedText(onlyDigits(Math.round(Number(value || 0))), width, "right", "0");
}

function exportFuelingsTxtErp() {
  const header = "Data       / Hora     / Usuario         / Veiculo         / Odometro / Litros     / Km Perc.   / Observacao / Terminal / Bomba";
  const rows = filteredFuelings().map((item) => {
    const parts = erpDateParts(item.createdAt);
    const vehicle = vehicleById(item.vehicleId);
    const data = consumption(item);
    return `${parts.date} ${parts.time} ${fixedText("100", 16)}${fixedText(vehicle?.code || "", 16)}${erpInteger(item.km, 7)} ${erpDecimalCents(item.liters)} ${erpInteger(data ? data.distance : 0, 10)} ${fixedText(fuelingObservation(item).replace(/\s+/g, " ").trim(), 10)} 00 7`;
  });
  const txt = [header, ...rows].join("\r\n");
  const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `SGCNET_ABASTECIMENTOS_${today().replaceAll("-", "")}.TXT`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast("Arquivo TXT do ERP gerado com codigo de usuario 100.");
}

function toast(message) {
  document.querySelector(".toast")?.remove();
  const node = document.createElement("div");
  node.className = "toast";
  node.textContent = message;
  document.body.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

init();

window.addEventListener("online", () => {
  toast("Conexão restabelecida. Sincronizando pendências...");
  syncOfflineFuelings();
});

window.addEventListener("offline", () => {
  render();
  toast("Sem conexão. Novos abastecimentos serão salvos como pendentes.");
});
