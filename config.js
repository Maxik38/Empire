// ============================================================
// KONFIGURÁCIA HRY - Fáza 1
// Tu sa ladí celý balans. Vzorce sú exponenciálne (typické pre
// strategické browser hry): cena aj čas rastú s úrovňou.
// ============================================================

const RESOURCE_META = {
  wood:  { label: 'Drevo',  icon: '🪵', color: '#8a5a3c' },
  stone: { label: 'Kameň',  icon: '🪨', color: '#8a8a8a' },
  food:  { label: 'Jedlo',  icon: '🌾', color: '#c9a24b' },
  gold:  { label: 'Zlato',  icon: '🪙', color: '#d4af37' },
};

// building_type -> definícia
const BUILDINGS = {
  main_hall: {
    label: 'Hlavná budova',
    icon: '🏛️',
    desc: 'Riadi hrad. Vyššia úroveň zrýchľuje všetku výstavbu.',
    maxLevel: 20,
    baseCost: { wood: 200, stone: 200, food: 0, gold: 100 },
    baseBuildSeconds: 60,
    produces: null,
  },
  sawmill: {
    label: 'Píla',
    icon: '🪓',
    desc: 'Produkuje drevo.',
    maxLevel: 20,
    baseCost: { wood: 80, stone: 40, food: 0, gold: 0 },
    baseBuildSeconds: 30,
    produces: { resource: 'wood', baseRate: 0.5 }, // za sekundu na úrovni 1
  },
  quarry: {
    label: 'Kameňolom',
    icon: '⛏️',
    desc: 'Produkuje kameň.',
    maxLevel: 20,
    baseCost: { wood: 80, stone: 40, food: 0, gold: 0 },
    baseBuildSeconds: 30,
    produces: { resource: 'stone', baseRate: 0.5 },
  },
  farm: {
    label: 'Farma',
    icon: '🌾',
    desc: 'Produkuje jedlo, ktoré živí armádu aj obyvateľov.',
    maxLevel: 20,
    baseCost: { wood: 60, stone: 30, food: 0, gold: 0 },
    baseBuildSeconds: 25,
    produces: { resource: 'food', baseRate: 0.35 },
  },
  warehouse: {
    label: 'Sklad',
    icon: '🏚️',
    desc: 'Zvyšuje kapacitu skladovania všetkých surovín.',
    maxLevel: 20,
    baseCost: { wood: 100, stone: 100, food: 0, gold: 20 },
    baseBuildSeconds: 40,
    produces: null,
    capacityBonusPerLevel: 500, // pridá sa ku všetkým surovinám
  },
  barracks: {
    label: 'Kasárne',
    icon: '⚔️',
    desc: 'Umožňuje trénovať jednotky. (Fáza 2)',
    maxLevel: 20,
    baseCost: { wood: 150, stone: 100, food: 50, gold: 0 },
    baseBuildSeconds: 90,
    produces: null,
  },
  empty: {
    label: 'Voľná parcela',
    icon: '➕',
    desc: 'Vyber budovu, ktorú tu postavíš.',
    maxLevel: 0,
    baseCost: null,
    baseBuildSeconds: 0,
    produces: null,
  },
};

// Budovy, ktoré je možné postaviť na "empty" parcelu
const BUILDABLE_ON_EMPTY = ['sawmill', 'quarry', 'farm', 'warehouse', 'barracks'];

const GROWTH = {
  cost: 1.55,       // cena_n = baseCost * growth.cost ^ (level)
  time: 1.45,       // čas_n  = baseBuildSeconds * growth.time ^ (level)
  production: 1.35, // produkcia rastie s úrovňou budovy
};

function getCostForLevel(buildingType, targetLevel) {
  const def = BUILDINGS[buildingType];
  if (!def.baseCost) return null;
  const factor = Math.pow(GROWTH.cost, targetLevel - 1);
  const cost = {};
  for (const r of Object.keys(def.baseCost)) {
    cost[r] = Math.round(def.baseCost[r] * factor);
  }
  return cost;
}

function getBuildSecondsForLevel(buildingType, targetLevel, mainHallLevel = 1) {
  const def = BUILDINGS[buildingType];
  const raw = def.baseBuildSeconds * Math.pow(GROWTH.time, targetLevel - 1);
  // Hlavná budova zrýchľuje výstavbu o 2% za úroveň
  const speedBonus = 1 - Math.min(0.5, (mainHallLevel - 1) * 0.02);
  return Math.round(raw * speedBonus);
}

function getProductionRate(buildingType, level) {
  const def = BUILDINGS[buildingType];
  if (!def.produces || level < 1) return 0;
  return def.produces.baseRate * Math.pow(GROWTH.production, level - 1);
}

function getCapacityBonus(buildingType, level) {
  const def = BUILDINGS[buildingType];
  if (!def.capacityBonusPerLevel || level < 1) return 0;
  return def.capacityBonusPerLevel * level;
}
