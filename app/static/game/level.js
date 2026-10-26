/* Zonas temáticas y generación procedural de niveles (arenas con obstáculos,
 * oleadas de enemigos y un portal de salida). Cada zona tiene su propia
 * paleta e identidad, sin reutilizar mapas ni tiles de ningún otro juego. */

import { randRange, randInt, clamp, circleOverlap } from "./engine.js";

export const ZONES = [
    {
        key: "sabana", name: "Sabana Dorada",
        sky: ["#f6d488", "#e7ab4d"], ground: "#d9a441", groundAlt: "#c68f34",
        obstacle: "#8a6b2a", obstacleDark: "#6b5220",
        enemyPool: ["pantera", "rana", "cebra"],
    },
    {
        key: "selva", name: "Selva Umbría",
        sky: ["#8fbf6b", "#4f8b3f"], ground: "#3f7a3a", groundAlt: "#356a31",
        obstacle: "#2e5a2b", obstacleDark: "#1f4020",
        enemyPool: ["pantera", "mono", "rana", "cebra"],
    },
    {
        key: "ruinas", name: "Ruinas Perdidas",
        sky: ["#cbb98a", "#a8916a"], ground: "#8f7a56", groundAlt: "#7c6949",
        obstacle: "#5d5040", obstacleDark: "#443a2e",
        enemyPool: ["mono", "gorila", "serpiente", "cebra"],
    },
    {
        key: "canion", name: "Cañón Bermejo",
        sky: ["#e08a5c", "#b8532f"], ground: "#a8532f", groundAlt: "#914527",
        obstacle: "#6e3620", obstacleDark: "#4f2716",
        enemyPool: ["gorila", "rana", "serpiente", "cebra"],
    },
    {
        key: "territorio", name: "Territorio Hostil",
        sky: ["#6a5a7a", "#3c3050"], ground: "#463a58", groundAlt: "#3a3049",
        obstacle: "#2a2338", obstacleDark: "#1a1524",
        enemyPool: ["pantera", "mono", "gorila", "serpiente", "cebra"],
    },
    {
        key: "jefe", name: "Guarida del Usurpador",
        sky: ["#3a1420", "#1a0810"], ground: "#33131c", groundAlt: "#2a0f17",
        obstacle: "#1c0a10", obstacleDark: "#12060a",
        enemyPool: [],
        boss: true,
    },
];

// Estética "The Legend of Zelda" (NES): todas las zonas comparten un suelo de
// tierra clara y plano, con una viñeta cálida a los bordes, y los obstáculos se
// dibujan como matojos/árboles verdes de 8 bits agrupados en cuadrícula.
const PALETA_ZELDA = {
    sky: ["#e9c893", "#e9c893"],
    ground: "#e9c893",
    groundAlt: "#e9c893",
    obstacle: "#3aa029", obstacleDark: "#1d6b16",
};
for (const zone of ZONES) Object.assign(zone, PALETA_ZELDA);

export class Level {
    constructor(zoneIndex, difficultyLevel) {
        this.zoneIndex = zoneIndex;
        this.zone = ZONES[zoneIndex];
        this.difficulty = difficultyLevel;
        this.width = this.zone.boss ? 1400 : 2200 + zoneIndex * 150;
        this.height = this.zone.boss ? 1000 : 1500 + zoneIndex * 100;
        this.bounds = { x0: 0, y0: 0, x1: this.width, y1: this.height };
        // El spawn y el portal deben existir antes de generar obstáculos: la
        // generación deja despejadas las zonas alrededor de ambos puntos.
        this.spawn = { x: 160, y: this.height / 2 };
        this.portal = { x: this.width - 160, y: this.height / 2, active: false, radius: 46 };
        this.obstacles = this.zone.boss ? this._genArena() : this._genObstacles();
        // Borde de arbustos que rodea todo el mapa. Va marcado como `border` y
        // el rugido NO lo puede arrancar.
        this.obstacles = this.obstacles.concat(this._genBorder());
    }

    _genBorder() {
        const R = 30, step = R * 1.5, m = R;
        const list = [];
        const edge = (x0, y0, x1, y1) => {
            const len = Math.hypot(x1 - x0, y1 - y0);
            const n = Math.max(1, Math.round(len / step));
            for (let k = 0; k <= n; k++) {
                const t = k / n;
                list.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t, radius: R, invMass: 0, border: true });
            }
        };
        edge(m, m, this.width - m, m);                              // arriba
        edge(m, this.height - m, this.width - m, this.height - m);  // abajo
        edge(m, m, m, this.height - m);                             // izquierda
        edge(this.width - m, m, this.width - m, this.height - m);   // derecha
        return list;
    }

    _genObstacles() {
        // Se generan setos (cercas de matojos) que dividen el mapa y dejan
        // pasillos entre ellos: paredes verticales con puertas + muros
        // horizontales cortos que obligan a serpentear. Spawn y portal quedan
        // despejados y siempre hay paso a través de cada puerta.
        const list = [];
        const R = 30;             // radio de cada mata de la cerca
        const step = R * 1.5;     // separación entre matas de un mismo seto
        const clear = 240;        // radio despejado alrededor de spawn y portal

        const blocked = (x, y) =>
            dist2(x, y, this.spawn.x, this.spawn.y) < clear * clear ||
            dist2(x, y, this.portal.x, this.portal.y) < clear * clear;

        const addWall = (x0, y0, x1, y1, gaps) => {
            const len = Math.hypot(x1 - x0, y1 - y0);
            const n = Math.max(1, Math.round(len / step));
            for (let k = 0; k <= n; k++) {
                const t = k / n;
                const x = x0 + (x1 - x0) * t;
                const y = y0 + (y1 - y0) * t;
                if (gaps && gaps.some((g) => Math.hypot(x - g.x, y - g.y) < g.r)) continue;
                if (blocked(x, y)) continue;
                list.push({ x, y, radius: R, invMass: 0 });
            }
        };

        // Cuánto más avanzada la zona / mayor la dificultad, más denso el mapa.
        const extra = this.zoneIndex + Math.floor(this.difficulty / 2);

        // Paredes verticales -> pasillos verticales entre ellas. Cada una con
        // 1-2 puertas anchas a distinta altura, así el camino zigzaguea.
        const walls = randInt(2, 3) + Math.floor(extra / 2);
        for (let b = 1; b <= walls; b++) {
            const x = (this.width * b) / (walls + 1) + randRange(-70, 70);
            const gaps = [];
            for (let d = 0, dc = randInt(1, 2); d < dc; d++) {
                gaps.push({ x, y: randRange(this.height * 0.18, this.height * 0.82), r: randRange(95, 135) });
            }
            addWall(x, 30, x, this.height - 30, gaps);
        }

        // Muros horizontales cortos que salen de un borde sin llegar al otro:
        // crean recodos y ramales sin cerrar nunca el paso.
        for (let s = 0, sc = randInt(2, 4) + extra; s < sc; s++) {
            const y = randRange(this.height * 0.2, this.height * 0.8);
            const fromLeft = Math.random() < 0.5;
            const x0 = fromLeft ? 30 : this.width - 30;
            const x1 = fromLeft
                ? randRange(this.width * 0.32, this.width * 0.6)
                : randRange(this.width * 0.4, this.width * 0.68);
            addWall(x0, y, x1, y, null);
        }

        // Matojos sueltos de cobertura repartidos por el mapa.
        const looseTarget = 10 + extra * 3;
        for (let loose = 0, tries = 0; loose < looseTarget && tries < looseTarget * 12; tries++) {
            const x = randRange(140, this.width - 140);
            const y = randRange(140, this.height - 140);
            if (blocked(x, y)) continue;
            list.push({ x, y, radius: randRange(24, 34), invMass: 0 });
            loose++;
        }

        return list;
    }

    _genArena() {
        // La sala del jefe queda más despejada, con solo unas columnas en el borde.
        const list = [];
        const cx = this.width / 2, cy = this.height / 2;
        for (let i = 0; i < 8; i++) {
            const a = (i / 8) * Math.PI * 2;
            list.push({
                x: cx + Math.cos(a) * (this.width * 0.42),
                y: cy + Math.sin(a) * (this.height * 0.42),
                radius: 34, invMass: 0,
            });
        }
        return list;
    }

    collideObstacles(entity) {
        for (const o of this.obstacles) {
            const hit = circleOverlap(entity, o);
            if (hit) {
                const dx = (entity.x - o.x) / hit.d;
                const dy = (entity.y - o.y) / hit.d;
                entity.x += dx * hit.overlap;
                entity.y += dy * hit.overlap;
            }
        }
        entity.x = clamp(entity.x, entity.radius, this.width - entity.radius);
        entity.y = clamp(entity.y, entity.radius, this.height - entity.radius);
    }

    blocksLineOfSight() {
        return false; // arenas abiertas: simplifica la IA de enemigos a distancia.
    }

    draw(ctx, cam) {
        const W = cam.viewW, H = cam.viewH;

        // Suelo de tierra clara y plano, estilo mapa de Zelda (NES).
        ctx.fillStyle = this.zone.ground;
        ctx.fillRect(0, 0, W, H);

        // Viñeta cálida hacia los bordes para dar profundidad.
        const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.15, W / 2, H / 2, Math.max(W, H) * 0.72);
        vg.addColorStop(0, "rgba(0,0,0,0)");
        vg.addColorStop(1, "rgba(74,45,15,0.42)");
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);

        for (const o of this.obstacles) {
            if (!cam.isVisible(o.x, o.y, o.radius + 40)) continue;
            const [sx, sy] = cam.toScreen(o.x, o.y);
            this._drawBush(ctx, o, sx, sy);
        }

        this._drawPortal(ctx, cam);
    }

    /** Dibuja un obstáculo como un grupo de matojos verdes de 8 bits (estilo
     *  Zelda NES): la huella cuadrada del obstáculo se cubre con una cuadrícula
     *  de tiles idénticos, cada uno un pequeño arbusto pixelado. */
    _drawBush(ctx, o, sx, sy) {
        const r = o.radius;
        const cols = Math.max(1, Math.round((r * 2) / 22));
        const tile = (r * 2) / cols;
        const px = tile / 8;
        // El borde del mapa se pinta en verdes más oscuros para que se note que
        // es un muro permanente (el rugido no lo quita).
        const pal = o.border ? SHRUB_COLORS_BORDER : SHRUB_COLORS;

        // Franja de tierra oscura en la base del grupo.
        ctx.fillStyle = "#5b3a1e";
        ctx.fillRect(sx - r, sy + r - px, r * 2, px * 1.6);

        for (let j = 0; j < cols; j++) {
            for (let i = 0; i < cols; i++) {
                drawShrubTile(ctx, sx - r + i * tile, sy - r + j * tile, px, ((i + j) & 1) === 1, pal);
            }
        }
    }

    _drawPortal(ctx, cam) {
        if (!cam.isVisible(this.portal.x, this.portal.y, 120)) return;
        const [sx, sy] = cam.toScreen(this.portal.x, this.portal.y);
        const r = this.portal.radius;

        // Boca de cueva estilo Zelda: arco negro recortado en la maleza.
        ctx.fillStyle = "#0a0a0a";
        ctx.beginPath();
        ctx.moveTo(sx - r * 0.82, sy + r * 0.72);
        ctx.lineTo(sx - r * 0.82, sy - r * 0.05);
        ctx.arc(sx, sy - r * 0.05, r * 0.82, Math.PI, 0);
        ctx.lineTo(sx + r * 0.82, sy + r * 0.72);
        ctx.closePath();
        ctx.fill();

        if (this.portal.active) {
            const t = performance.now() / 500;
            ctx.save();
            ctx.strokeStyle = "#fff3c4";
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.55 + Math.sin(t * 1.4) * 0.3;
            ctx.beginPath();
            ctx.arc(sx, sy, r + 8 + Math.sin(t * 1.4) * 5, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }
}

// Un tile de matojo de 8x8 "píxeles": 1 = verde oscuro (contorno), 2 = verde
// medio (sombra/motas), 3 = verde claro (masa). Silueta redondeada arriba y
// abajo para que al repetirse en cuadrícula parezca un seto continuo.
const SHRUB_TILE = [
    [0, 1, 1, 1, 1, 1, 1, 0],
    [1, 3, 3, 3, 3, 2, 2, 1],
    [1, 3, 3, 2, 3, 3, 2, 1],
    [1, 3, 2, 3, 3, 3, 3, 1],
    [1, 2, 3, 3, 2, 3, 3, 1],
    [1, 3, 3, 3, 3, 3, 2, 1],
    [1, 1, 2, 3, 3, 2, 1, 1],
    [0, 1, 1, 1, 1, 1, 1, 0],
];
const SHRUB_COLORS = { 1: "#1d6b16", 2: "#2f8f23", 3: "#5fc23a" };
const SHRUB_COLORS_BORDER = { 1: "#0e3f0b", 2: "#155a12", 3: "#2c7d1f" };

function drawShrubTile(ctx, ox, oy, px, flip, colors = SHRUB_COLORS) {
    for (let row = 0; row < 8; row++) {
        for (let c = 0; c < 8; c++) {
            const v = SHRUB_TILE[row][flip ? 7 - c : c];
            if (!v) continue;
            ctx.fillStyle = colors[v];
            ctx.fillRect(ox + c * px, oy + row * px, px + 0.6, px + 0.6);
        }
    }
}

function dist2(x1, y1, x2, y2) {
    const dx = x1 - x2, dy = y1 - y2;
    return dx * dx + dy * dy;
}

/** Oleadas de enemigos de una zona según el nivel de dificultad global (0-based). */
export function generateWaves(zoneIndex, difficultyLevel) {
    const zone = ZONES[zoneIndex];
    if (zone.boss) return [{ boss: true }];

    const waveCount = 3;
    const waves = [];
    for (let w = 0; w < waveCount; w++) {
        const baseCount = 3 + difficultyLevel + w;
        const enemies = [];
        for (let i = 0; i < baseCount; i++) {
            const kind = zone.enemyPool[randInt(0, zone.enemyPool.length - 1)];
            const eliteChance = clamp(0.05 + difficultyLevel * 0.05, 0, 0.4);
            enemies.push({ kind, elite: Math.random() < eliteChance });
        }
        waves.push({ enemies });
    }
    return waves;
}
