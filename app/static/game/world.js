/* Orquesta una partida en curso: nivel, oleadas de enemigos, proyectiles,
 * pickups, partículas y cámara. main.js crea un World por nivel y llama a
 * update()/draw() en cada frame del bucle de juego. */

import { Camera, angleTo, dist, circleOverlap, resolveCircleCollision, randRange, clamp } from "./engine.js";
import { Level, ZONES, generateWaves } from "./level.js";
import { Lion } from "./player.js";
import { createEnemy, Boss } from "./enemies.js";
import { Pickup } from "./pickups.js";
import { ParticleSystem } from "./particles.js";
import { audio } from "./audio.js";

export class World {
    constructor(zoneIndex, difficultyLevel, bonuses, viewW, viewH) {
        this.zoneIndex = zoneIndex;
        this.difficultyLevel = difficultyLevel;
        this.level = new Level(zoneIndex, difficultyLevel);
        this.camera = new Camera(viewW, viewH);
        this.camera.x = this.level.spawn.x;
        this.camera.y = this.level.spawn.y;
        this.player = new Lion(this.level.spawn.x, this.level.spawn.y, bonuses);
        this.particles = new ParticleSystem();
        this.enemies = [];
        this.projectiles = [];
        this.pickups = [];
        this.waves = generateWaves(zoneIndex, difficultyLevel);
        this.waveIndex = -1;
        this.waveDelay = 0.6;
        this.isBossLevel = !!this.level.zone.boss;
        this.boss = null;

        this.runCoins = 0;
        this.runGems = 0;
        this.kills = 0;
        this.elapsed = 0;
        this.finished = false; // portal cruzado
        this.playerDied = false;
        this.bossDefeated = false;

        // Hooks que main.js puede sobreescribir para reaccionar a eventos del juego
        // (fin de la partida, cruce del portal). onEnemyKilled/onBossKilled son
        // llamados directamente por enemies.js y no deben reasignarse.
        this.onPlayerDied = () => {};
        this.onPortalEnter = () => {};
        // Las gemas son moneda persistente: se banca de inmediato al recogerlas,
        // sin esperar a terminar el nivel (así nunca se "pierden" al morir).
        this.onGemBanked = () => {};
    }

    /** Punto libre a media distancia del jugador (para el antídoto de veneno). */
    _spawnPointNearPlayer(minDist = 180, maxDist = 340) {
        for (let i = 0; i < 24; i++) {
            const ang = Math.random() * Math.PI * 2;
            const r = randRange(minDist, maxDist);
            const x = clamp(this.player.x + Math.cos(ang) * r, 60, this.level.width - 60);
            const y = clamp(this.player.y + Math.sin(ang) * r, 60, this.level.height - 60);
            if (this.level.obstacles.some((o) => dist(x, y, o.x, o.y) < o.radius + 30)) continue;
            return { x, y };
        }
        return { x: clamp(this.player.x + 200, 60, this.level.width - 60), y: this.player.y };
    }

    /** Suelta un antídoto en el mapa cuando el jugador queda envenenado (uno a la vez). */
    spawnCurePickup() {
        if (this.pickups.some((p) => p.kind === "cure")) return;
        const p = this._spawnPointNearPlayer();
        this.pickups.push(new Pickup(p.x, p.y, "cure"));
        this.particles.sparkle(p.x, p.y, "#a9e86a");
    }

    _spawnPointFarFromPlayer(minDist = 420) {
        for (let i = 0; i < 20; i++) {
            const x = randRange(60, this.level.width - 60);
            const y = randRange(60, this.level.height - 60);
            if (dist(x, y, this.player.x, this.player.y) >= minDist) return { x, y };
        }
        return { x: this.level.width - 100, y: randRange(60, this.level.height - 60) };
    }

    _startNextWave() {
        this.waveIndex++;
        if (this.waveIndex >= this.waves.length) return;
        const wave = this.waves[this.waveIndex];
        if (wave.boss) {
            const p = { x: this.level.width / 2, y: this.level.height / 2 };
            this.boss = new Boss(p.x, p.y, this.difficultyLevel);
            this.enemies.push(this.boss);
            audio.sfxBossRoar();
            return;
        }
        for (const def of wave.enemies) {
            const p = this._spawnPointFarFromPlayer();
            this.enemies.push(createEnemy(def.kind, p.x, p.y, def.elite, this.difficultyLevel));
        }
    }

    _dropFromEnemy(enemy) {
        const roll = Math.random();
        let kind = null;
        if (enemy.elite) {
            kind = roll < 0.28 ? "gem" : roll < 0.45 ? "heart" : "coin";
        } else if (roll < 0.06) kind = "gem";
        else if (roll < 0.2) kind = "heart";
        else if (roll < 0.75) kind = "coin";
        if (kind) this.pickups.push(new Pickup(enemy.x + randRange(-10, 10), enemy.y + randRange(-10, 10), kind));
    }

    /** Llamado directamente desde Enemy.die() (enemies.js) al morir un enemigo normal. */
    onEnemyKilled(enemy) {
        this.kills++;
        this._dropFromEnemy(enemy);
    }

    /** Llamado directamente desde Boss.die() (enemies.js) al derrotar al jefe final. */
    onBossKilled(boss) {
        this.kills++;
        this.bossDefeated = true;
        for (let i = 0; i < 3; i++) {
            this.pickups.push(new Pickup(boss.x + randRange(-30, 30), boss.y + randRange(-30, 30), "gem"));
        }
        for (let i = 0; i < 5; i++) {
            this.pickups.push(new Pickup(boss.x + randRange(-40, 40), boss.y + randRange(-40, 40), "coin"));
        }
        this.level.portal.active = true;
    }

    collectPickup(pickup) {
        if (pickup.kind === "coin") { this.runCoins += 1; audio.sfxCoin(); this.particles.sparkle(pickup.x, pickup.y, "#f3d99a"); }
        else if (pickup.kind === "gem") { this.runGems += 1; audio.sfxGem(); this.particles.sparkle(pickup.x, pickup.y, "#7fe8e0"); this.onGemBanked(); }
        else if (pickup.kind === "heart") { this.player.heal(24, this.particles); audio.sfxHeart(); }
        else if (pickup.kind === "cure") {
            this.player.curePoison(this.particles);
            this.player.heal(30, this.particles);
            audio.sfxHeart();
            this.particles.sparkle(pickup.x, pickup.y, "#a9e86a");
        }
    }

    update(dt, input) {
        if (this.finished) return;
        this.elapsed += dt;

        if (this.waveIndex < 0) this._startNextWave();

        this.player.update(dt, input, this);
        if (!this.player.alive && !this.playerDied) {
            this.playerDied = true;
            this.onPlayerDied();
        }

        // Proyectiles: colisión contra enemigos (del jugador) o contra el jugador (enemigos).
        for (const proj of this.projectiles) {
            proj.update(dt, this.level);
            if (proj.dead) continue;
            if (proj.kind === "claw") {
                for (const enemy of this.enemies) {
                    if (enemy.dead || proj.hitSet.has(enemy)) continue;
                    if (dist(proj.x, proj.y, enemy.x, enemy.y) < proj.radius + enemy.radius) {
                        const a = angleTo(this.player.x, this.player.y, enemy.x, enemy.y);
                        enemy.takeDamage(proj.damage, this, a);
                        proj.hitSet.add(enemy);
                        proj.pierce--;
                        if (proj.pierce < 0) proj.dead = true;
                    }
                }
            } else if (proj.kind === "bolt" || proj.kind === "spike") {
                if (this.player.alive && dist(proj.x, proj.y, this.player.x, this.player.y) < proj.radius + this.player.radius) {
                    this.player.takeDamage(proj.damage, this.particles);
                    if (proj.poison && this.player.alive) {
                        this.player.applyPoison();
                        this.spawnCurePickup();
                        audio.sfxPoison();
                    }
                    proj.dead = true;
                }
            }
        }
        this.projectiles = this.projectiles.filter((p) => !p.dead);

        for (const enemy of this.enemies) {
            if (enemy.dead) continue;
            enemy.update(dt, this);
        }
        // Separación suave entre enemigos para que no se apilen exactamente encima.
        for (let i = 0; i < this.enemies.length; i++) {
            for (let j = i + 1; j < this.enemies.length; j++) {
                const a = this.enemies[i], b = this.enemies[j];
                if (a.dead || b.dead) continue;
                const hit = circleOverlap(a, b);
                if (hit) resolveCircleCollision(a, b, hit);
            }
        }
        this.enemies = this.enemies.filter((e) => !e.dead);

        for (const p of this.pickups) {
            p.update(dt, this.player);
            if (p.collected && !p.dead) {
                this.collectPickup(p);
                p.dead = true;
            }
        }
        this.pickups = this.pickups.filter((p) => !p.dead);

        this.particles.update(dt);

        if (this.waveIndex >= 0 && this.waveIndex < this.waves.length - 1 && this.enemies.length === 0) {
            this.waveDelay -= dt;
            if (this.waveDelay <= 0) {
                this.waveDelay = 1.4;
                this._startNextWave();
            }
        } else if (!this.isBossLevel && this.waveIndex >= this.waves.length - 1 && this.enemies.length === 0) {
            if (!this.level.portal.active) {
                this.level.portal.active = true;
                audio.sfxPortal();
            }
        }

        this.camera.follow(this.player.x, this.player.y, dt, this.level.bounds);

        if (this.level.portal.active && this.player.alive) {
            const d = dist(this.player.x, this.player.y, this.level.portal.x, this.level.portal.y);
            if (d < this.level.portal.radius && !this.finished) {
                this.finished = true;
                this.onPortalEnter();
            }
        }
    }

    draw(ctx) {
        this.level.draw(ctx, this.camera);
        for (const p of this.pickups) p.draw(ctx, this.camera);
        for (const enemy of this.enemies) enemy.draw(ctx, this.camera);
        this.player.draw(ctx, this.camera);
        for (const proj of this.projectiles) proj.draw(ctx, this.camera);
        this.particles.draw(ctx, this.camera);
    }

    getMinimapData() {
        return {
            width: this.level.width,
            height: this.level.height,
            player: { x: this.player.x, y: this.player.y },
            portal: { x: this.level.portal.x, y: this.level.portal.y, active: this.level.portal.active },
            cures: this.pickups.filter((p) => p.kind === "cure").map((p) => ({ x: p.x, y: p.y })),
            enemies: this.enemies.map((e) => ({ x: e.x, y: e.y, elite: e.elite, boss: e instanceof Boss })),
        };
    }
}

export { ZONES };
