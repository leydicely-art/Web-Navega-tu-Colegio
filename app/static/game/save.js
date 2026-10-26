/* Persistencia en localStorage: gemas (moneda meta, persistente entre partidas),
 * mejoras permanentes compradas y mejor nivel alcanzado. Independiente de la
 * base de datos del portal: funciona igual para invitados y estudiantes. */

const SAVE_KEY = "rugidoSalvaje.save.v1";

/** Catálogo de mejoras permanentes (se compran con gemas en el menú "Mejoras"). */
export const PERMANENT_UPGRADES = [
    { key: "vida", label: "Corazón de León", icon: "❤️", desc: "+15 de vida máxima", baseCost: 3, costGrowth: 1.6, maxLevel: 5 },
    { key: "danio", label: "Garra Afilada", icon: "🗡️", desc: "+12% de daño de zarpazo", baseCost: 3, costGrowth: 1.6, maxLevel: 5 },
    { key: "velocidad", label: "Patas Veloces", icon: "💨", desc: "+8% de velocidad", baseCost: 2, costGrowth: 1.6, maxLevel: 4 },
    { key: "cooldown", label: "Aliento Salvaje", icon: "🌬️", desc: "-10% de reutilización de habilidades", baseCost: 3, costGrowth: 1.7, maxLevel: 4 },
    { key: "rango", label: "Vista de Cazador", icon: "🎯", desc: "+10% de alcance del zarpazo", baseCost: 2, costGrowth: 1.5, maxLevel: 3 },
    { key: "rugido", label: "Rugido Ancestral", icon: "📣", desc: "+20% de radio y aturdimiento del rugido", baseCost: 4, costGrowth: 1.8, maxLevel: 3 },
];

function defaultSave() {
    return {
        gems: 0,
        bestLevel: 0,
        upgrades: Object.fromEntries(PERMANENT_UPGRADES.map((u) => [u.key, 0])),
        stats: { runs: 0, kills: 0, bestRunKills: 0 },
    };
}

export function loadSave() {
    try {
        const raw = localStorage.getItem(SAVE_KEY);
        if (!raw) return defaultSave();
        const parsed = JSON.parse(raw);
        const base = defaultSave();
        return {
            ...base,
            ...parsed,
            upgrades: { ...base.upgrades, ...(parsed.upgrades || {}) },
            stats: { ...base.stats, ...(parsed.stats || {}) },
        };
    } catch (err) {
        console.warn("No se pudo leer el progreso guardado, se reinicia.", err);
        return defaultSave();
    }
}

export function writeSave(save) {
    try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(save));
    } catch (err) {
        console.warn("No se pudo guardar el progreso.", err);
    }
}

export function upgradeCost(def, currentLevel) {
    return Math.round(def.baseCost * Math.pow(def.costGrowth, currentLevel));
}

/** Convierte las mejoras permanentes compradas en bonificaciones concretas para el león. */
export function permanentBonuses(save) {
    const lvl = (k) => save.upgrades[k] || 0;
    return {
        maxHealthBonus: lvl("vida") * 15,
        damageMult: 1 + lvl("danio") * 0.12,
        speedMult: 1 + lvl("velocidad") * 0.08,
        cooldownMult: Math.max(0.4, 1 - lvl("cooldown") * 0.1),
        rangeMult: 1 + lvl("rango") * 0.1,
        roarMult: 1 + lvl("rugido") * 0.2,
    };
}
