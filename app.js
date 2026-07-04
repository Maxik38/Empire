// ============================================================
// EMPIRE GAME - hlavná logika (Fáza 1)
// ============================================================

let state = {
  user: null,
  castle: null,
  resources: {},   // { wood: {amount, capacity, production_rate, last_updated_at}, ... }
  buildings: [],   // [{id, building_type, level, slot}]
  queue: [],       // [{id, building_id, target_level, finish_at, completed}]
};

let selectedSlot = null;
let tickInterval = null;
let pollInterval = null;

// ------------------------------------------------------------
// AUTH
// ------------------------------------------------------------
async function init() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (session) {
    state.user = session.user;
    await enterGame();
  } else {
    showScreen('auth');
  }

  document.getElementById('login-form').addEventListener('submit', handleLogin);
  document.getElementById('register-form').addEventListener('submit', handleRegister);
  document.getElementById('show-register').addEventListener('click', () => toggleAuthForm(true));
  document.getElementById('show-login').addEventListener('click', () => toggleAuthForm(false));
  document.getElementById('logout-btn').addEventListener('click', handleLogout);
  document.getElementById('modal-close').addEventListener('click', closeModal);
}

function toggleAuthForm(showRegister) {
  document.getElementById('login-form').classList.toggle('hidden', showRegister);
  document.getElementById('register-form').classList.toggle('hidden', !showRegister);
}

async function handleLogin(e) {
  e.preventDefault();
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  setAuthError('');
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) return setAuthError(error.message);
  state.user = data.user;
  await enterGame();
}

async function handleRegister(e) {
  e.preventDefault();
  const email = document.getElementById('register-email').value;
  const password = document.getElementById('register-password').value;
  const username = document.getElementById('register-username').value.trim();
  setAuthError('');

  if (username.length < 3) return setAuthError('Meno musí mať aspoň 3 znaky.');

  const { data, error } = await supabaseClient.auth.signUp({ email, password });
  if (error) return setAuthError(error.message);

  state.user = data.user;

  // Založ počiatočný hrad cez SQL funkciu (server-side)
  const { error: rpcError } = await supabaseClient.rpc('create_starter_castle', { p_username: username });
  if (rpcError) return setAuthError('Chyba pri zakladaní hradu: ' + rpcError.message);

  await enterGame();
}

async function handleLogout() {
  clearInterval(tickInterval);
  clearInterval(pollInterval);
  await supabaseClient.auth.signOut();
  state = { user: null, castle: null, resources: {}, buildings: [], queue: [] };
  showScreen('auth');
}

function setAuthError(msg) {
  document.getElementById('auth-error').textContent = msg;
}

function showScreen(name) {
  document.getElementById('auth-screen').classList.toggle('hidden', name !== 'auth');
  document.getElementById('game-screen').classList.toggle('hidden', name !== 'game');
}

// ------------------------------------------------------------
// VSTUP DO HRY - načítanie hradu a spustenie herných cyklov
// ------------------------------------------------------------
async function enterGame() {
  showScreen('game');
  await loadCastleData();
  renderAll();

  // Lokálny "tick" - plynulá animácia surovín každú sekundu (len vizuál)
  tickInterval = setInterval(localResourceTick, 1000);

  // Poll servera - kontrola dokončených front a synchronizácia (každých 10s)
  pollInterval = setInterval(syncWithServer, 10000);
}

async function loadCastleData() {
  const { data: castle } = await supabaseClient
    .from('castles')
    .select('*')
    .eq('owner_id', state.user.id)
    .single();
  state.castle = castle;

  const { data: resources } = await supabaseClient
    .from('castle_resources')
    .select('*')
    .eq('castle_id', castle.id);
  state.resources = {};
  for (const r of resources) state.resources[r.resource_type] = r;

  const { data: buildings } = await supabaseClient
    .from('castle_buildings')
    .select('*')
    .eq('castle_id', castle.id)
    .order('slot');
  state.buildings = buildings;

  const { data: queue } = await supabaseClient
    .from('build_queue')
    .select('*')
    .eq('castle_id', castle.id)
    .eq('completed', false);
  state.queue = queue;

  // Dopočítaj produkciu odkedy hráč naposledy bol online (offline gains)
  applyOfflineProduction();
  await checkFinishedQueue();
}

// ------------------------------------------------------------
// PRODUKCIA SUROVÍN (funguje aj offline vďaka timestampom)
// ------------------------------------------------------------
function getTotalProductionRate(resourceType) {
  let rate = 0;
  for (const b of state.buildings) {
    const def = BUILDINGS[b.building_type];
    if (def && def.produces && def.produces.resource === resourceType) {
      rate += getProductionRate(b.building_type, b.level);
    }
  }
  return rate;
}

function getTotalCapacity(resourceType) {
  const base = state.resources[resourceType]?.capacity || 1000;
  let bonus = 0;
  for (const b of state.buildings) {
    bonus += getCapacityBonus(b.building_type, b.level);
  }
  return base + bonus;
}

function applyOfflineProduction() {
  const now = Date.now();
  for (const type of Object.keys(state.resources)) {
    const res = state.resources[type];
    const elapsedSec = Math.max(0, (now - new Date(res.last_updated_at).getTime()) / 1000);
    const rate = getTotalProductionRate(type);
    const capacity = getTotalCapacity(type);
    res.amount = Math.min(capacity, parseFloat(res.amount) + elapsedSec * rate);
    res.last_updated_at = new Date().toISOString();
  }
  persistResources(); // ulož dopočítaný stav a nový timestamp
}

function localResourceTick() {
  // Vizuálny tick medzi synchronizáciami - nemení last_updated_at v DB,
  // len plynule posúva čísla na obrazovke.
  for (const type of Object.keys(state.resources)) {
    const res = state.resources[type];
    const rate = getTotalProductionRate(type);
    const capacity = getTotalCapacity(type);
    res.amount = Math.min(capacity, parseFloat(res.amount) + rate);
  }
  renderResourceBar();
  renderQueue();
}

async function persistResources() {
  for (const type of Object.keys(state.resources)) {
    const res = state.resources[type];
    await supabaseClient
      .from('castle_resources')
      .update({ amount: res.amount, last_updated_at: res.last_updated_at })
      .eq('castle_id', state.castle.id)
      .eq('resource_type', type);
  }
}

// ------------------------------------------------------------
// SYNC SO SERVEROM (pravidelne, aby DB nezaostávala príliš)
// ------------------------------------------------------------
async function syncWithServer() {
  // pripočítaj plynulý lokálny tick do "oficiálneho" last_updated_at
  const now = new Date().toISOString();
  for (const type of Object.keys(state.resources)) {
    state.resources[type].last_updated_at = now;
  }
  await persistResources();
  await checkFinishedQueue();
}

// ------------------------------------------------------------
// FRONTA VÝSTAVBY
// ------------------------------------------------------------
async function checkFinishedQueue() {
  const now = Date.now();
  const finished = state.queue.filter(q => new Date(q.finish_at).getTime() <= now);

  for (const item of finished) {
    const building = state.buildings.find(b => b.id === item.building_id);
    if (!building) continue;

    building.level = item.target_level;
    await supabaseClient.from('castle_buildings').update({ level: item.target_level }).eq('id', building.id);
    await supabaseClient.from('build_queue').update({ completed: true }).eq('id', item.id);
  }

  if (finished.length) {
    state.queue = state.queue.filter(q => !finished.includes(q));
    renderAll();
  }
}

function isSlotBusy(buildingId) {
  return state.queue.some(q => q.building_id === buildingId);
}

async function startUpgrade(buildingId, chosenType = null) {
  const building = state.buildings.find(b => b.id === buildingId);
  if (!building) return;
  if (isSlotBusy(buildingId)) return alert('Táto parcela už niečo stavia.');

  let buildingType = building.building_type;
  if (buildingType === 'empty') {
    if (!chosenType) return alert('Vyber typ budovy.');
    buildingType = chosenType;
  }

  const targetLevel = building.building_type === 'empty' ? 1 : building.level + 1;
  const cost = getCostForLevel(buildingType, targetLevel);
  const mainHall = state.buildings.find(b => b.building_type === 'main_hall');
  const seconds = getBuildSecondsForLevel(buildingType, targetLevel, mainHall?.level || 1);

  // over suroviny
  for (const r of Object.keys(cost)) {
    if ((state.resources[r]?.amount || 0) < cost[r]) {
      return alert(`Nedostatok suroviny: ${RESOURCE_META[r].label} (potrebuješ ${cost[r]})`);
    }
  }

  // odpočítaj suroviny lokálne aj v DB
  for (const r of Object.keys(cost)) {
    state.resources[r].amount -= cost[r];
  }
  await persistResources();

  // ak stavia nová budova na prázdnej parcele, zmeň building_type hneď (level ostáva 0 do dokončenia)
  if (building.building_type === 'empty') {
    building.building_type = buildingType;
    await supabaseClient.from('castle_buildings').update({ building_type: buildingType }).eq('id', building.id);
  }

  const finishAt = new Date(Date.now() + seconds * 1000).toISOString();
  const { data: queueItem, error } = await supabaseClient
    .from('build_queue')
    .insert({ castle_id: state.castle.id, building_id: building.id, target_level: targetLevel, finish_at: finishAt })
    .select()
    .single();

  if (error) return alert('Chyba: ' + error.message);

  state.queue.push(queueItem);
  closeModal();
  renderAll();
}

// ------------------------------------------------------------
// RENDER
// ------------------------------------------------------------
function renderAll() {
  renderResourceBar();
  renderCastleGrid();
  renderQueue();
  document.getElementById('castle-name').textContent = `${state.castle.name} (${state.castle.x}, ${state.castle.y})`;
}

function renderResourceBar() {
  const bar = document.getElementById('resource-bar');
  bar.innerHTML = '';
  for (const type of ['wood', 'stone', 'food', 'gold']) {
    const res = state.resources[type];
    if (!res) continue;
    const meta = RESOURCE_META[type];
    const capacity = getTotalCapacity(type);
    const rate = getTotalProductionRate(type);
    const pct = Math.min(100, (res.amount / capacity) * 100);

    const el = document.createElement('div');
    el.className = 'resource-item';
    el.innerHTML = `
      <span class="resource-icon">${meta.icon}</span>
      <div class="resource-info">
        <div class="resource-numbers">
          <span class="resource-amount">${Math.floor(res.amount).toLocaleString()}</span>
          <span class="resource-capacity">/ ${Math.floor(capacity).toLocaleString()}</span>
        </div>
        <div class="resource-bar-track"><div class="resource-bar-fill" style="width:${pct}%; background:${meta.color}"></div></div>
        <span class="resource-rate">+${rate.toFixed(1)}/s</span>
      </div>
    `;
    bar.appendChild(el);
  }
}

function renderCastleGrid() {
  const grid = document.getElementById('castle-grid');
  grid.innerHTML = '';
  const sorted = [...state.buildings].sort((a, b) => a.slot - b.slot);

  for (const b of sorted) {
    const def = BUILDINGS[b.building_type];
    const busy = isSlotBusy(b.id);
    const tile = document.createElement('div');
    tile.className = 'building-tile' + (busy ? ' building-busy' : '');
    tile.innerHTML = `
      <div class="building-icon">${def.icon}</div>
      <div class="building-name">${def.label}</div>
      ${b.building_type !== 'empty' ? `<div class="building-level">Úr. ${b.level}</div>` : ''}
      ${busy ? '<div class="building-badge">⏳</div>' : ''}
    `;
    tile.addEventListener('click', () => openBuildingModal(b.id));
    grid.appendChild(tile);
  }
}

function renderQueue() {
  const panel = document.getElementById('queue-panel');
  panel.innerHTML = '<h3>Fronta výstavby</h3>';
  if (!state.queue.length) {
    panel.innerHTML += '<p class="queue-empty">Žiadna prebiehajúca výstavba.</p>';
    return;
  }
  for (const q of state.queue) {
    const building = state.buildings.find(b => b.id === q.building_id);
    const def = BUILDINGS[building.building_type];
    const remaining = Math.max(0, Math.floor((new Date(q.finish_at).getTime() - Date.now()) / 1000));
    const row = document.createElement('div');
    row.className = 'queue-item';
    row.innerHTML = `
      <span>${def.icon} ${def.label} → úr. ${q.target_level}</span>
      <span class="queue-timer">${formatTime(remaining)}</span>
    `;
    panel.appendChild(row);
  }
}

function formatTime(totalSeconds) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map(v => String(v).padStart(2, '0')).join(':');
}

// ------------------------------------------------------------
// MODÁL - detail budovy / voľba novej budovy
// ------------------------------------------------------------
function openBuildingModal(buildingId) {
  const building = state.buildings.find(b => b.id === buildingId);
  const modal = document.getElementById('modal');
  const body = document.getElementById('modal-body');
  selectedSlot = buildingId;

  if (building.building_type === 'empty') {
    body.innerHTML = `
      <h2>Voľná parcela</h2>
      <p>Vyber, čo tu postavíš:</p>
      <div class="build-options">
        ${BUILDABLE_ON_EMPTY.map(type => {
          const def = BUILDINGS[type];
          const cost = getCostForLevel(type, 1);
          return `<button class="build-option" data-type="${type}">
            <div class="building-icon">${def.icon}</div>
            <div>${def.label}</div>
            <div class="cost-line">${formatCost(cost)}</div>
          </button>`;
        }).join('')}
      </div>
    `;
    body.querySelectorAll('.build-option').forEach(btn => {
      btn.addEventListener('click', () => startUpgrade(buildingId, btn.dataset.type));
    });
  } else {
    const def = BUILDINGS[building.building_type];
    const busy = isSlotBusy(buildingId);
    const nextLevel = building.level + 1;
    const atMax = building.level >= def.maxLevel;
    const cost = atMax ? null : getCostForLevel(building.building_type, nextLevel);
    const mainHall = state.buildings.find(b => b.building_type === 'main_hall');
    const seconds = atMax ? 0 : getBuildSecondsForLevel(building.building_type, nextLevel, mainHall?.level || 1);
    const currentRate = def.produces ? getProductionRate(building.building_type, building.level) : null;
    const nextRate = def.produces && !atMax ? getProductionRate(building.building_type, nextLevel) : null;

    body.innerHTML = `
      <h2>${def.icon} ${def.label} — úroveň ${building.level}</h2>
      <p>${def.desc}</p>
      ${currentRate !== null ? `<p class="stat-line">Súčasná produkcia: <strong>+${currentRate.toFixed(2)}/s</strong></p>` : ''}
      ${def.capacityBonusPerLevel ? `<p class="stat-line">Bonus kapacity: <strong>+${getCapacityBonus(building.building_type, building.level)}</strong></p>` : ''}
      <hr/>
      ${atMax
        ? '<p><strong>Maximálna úroveň dosiahnutá.</strong></p>'
        : busy
          ? '<p><strong>Práve sa vylepšuje...</strong></p>'
          : `
            <p>Vylepšiť na úroveň ${nextLevel}:</p>
            <p class="cost-line">${formatCost(cost)}</p>
            ${nextRate !== null ? `<p class="stat-line">Nová produkcia: <strong>+${nextRate.toFixed(2)}/s</strong></p>` : ''}
            <p class="stat-line">Čas výstavby: <strong>${formatTime(seconds)}</strong></p>
            <button id="upgrade-btn" class="primary-btn">Vylepšiť</button>
          `
      }
    `;
    if (!atMax && !busy) {
      document.getElementById('upgrade-btn').addEventListener('click', () => startUpgrade(buildingId));
    }
  }

  modal.classList.remove('hidden');
}

function formatCost(cost) {
  return Object.entries(cost)
    .filter(([, v]) => v > 0)
    .map(([r, v]) => `${RESOURCE_META[r].icon} ${v}`)
    .join('  ');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
  selectedSlot = null;
}

window.addEventListener('DOMContentLoaded', init);
