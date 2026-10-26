/* Enemigos del territorio salvaje: cada uno con una IA propia, más un jefe
 * final con tres fases. Diseño e identidad visual originales (nada de
 * slimes/saltarines del proyecto de referencia). */

import { Entity, angleTo, dist, randRange, clamp } from "./engine.js";
import { EnemyBolt, EnemySpike } from "./projectiles.js";
import { audio } from "./audio.js";

// Animales de la selva. Cada clave conserva el rol de IA del enemigo anterior
// (perseguidor básico, veloz errático, atacante a distancia, tanque que embiste
// y apoyo/chamán), pero con aspecto y nombre de fauna selvática.
const DEFS = {
    pantera:   { radius: 14, hp: 30, speed: 155, damage: 10, color: "#2c2c34", dark: "#151519", contactCd: 0.7, name: "Pantera Negra" },
    rana:      { radius: 13, hp: 22, speed: 120, damage: 8,  color: "#3fae3a", dark: "#2c7d2a", contactCd: 0.9, name: "Rana Venenosa" },
    mono:      { radius: 12, hp: 18, speed: 260, damage: 8,  color: "#7a5230", dark: "#573922", contactCd: 0.6, name: "Mono Aullador" },
    gorila:    { radius: 18, hp: 72, speed: 95,  damage: 16, color: "#3a3a41", dark: "#222226", contactCd: 0.9, name: "Gorila Plateado" },
    serpiente: { radius: 14, hp: 26, speed: 110, damage: 6,  color: "#5aa02f", dark: "#3c6f1f", contactCd: 1.0, name: "Serpiente Chamán" },
    cebra:     { radius: 16, hp: 34, speed: 240, damage: 12, color: "#f0e7b7", dark: "#7e6e2d", contactCd: 0.8, name: "Cebra Salvaje" },
};

export const DROP_TABLE = { coinChance: 0.55, gemChance: 0.06, heartChance: 0.12 };

export class Enemy extends Entity {
    constructor(x, y, kind, elite, difficultyLevel) {
        const def = DEFS[kind];
        super(x, y, def.radius * (elite ? 1.18 : 1));
        this.kind = kind;
        this.def = def;
        this.elite = elite;
        const hpMult = (1 + difficultyLevel * 0.32) * (elite ? 1.9 : 1);
        const dmgMult = (1 + difficultyLevel * 0.18) * (elite ? 1.5 : 1);
        const spdMult = (1 + difficultyLevel * 0.05) * (elite ? 1.1 : 1);
        this.maxHp = Math.round(def.hp * hpMult);
        this.hp = this.maxHp;
        this.speed = def.speed * spdMult;
        this.damage = def.damage * dmgMult;
        this.contactTimer = 0;
        this.stun = 0;
        this.hitFlash = 0;
        this.invMass = 1;
        this.abilityTimer = randRange(1, 2.5);
        this._face = 0; // ángulo de orientación (se actualiza al moverse)
    }

    /** Ángulo hacia el que "mira" el animal, según su velocidad actual. */
    get _heading() {
        const s = Math.hypot(this.vx, this.vy);
        if (s > 8) this._face = Math.atan2(this.vy, this.vx);
        return this._face || 0;
    }

    takeDamage(amount, world, knockAngle = null) {
        if (this.dead) return;
        this.hp -= amount;
        this.hitFlash = 0.15;
        world.particles.hitSpark(this.x, this.y, this.elite ? "#ffd35c" : "#fff3c4");
        world.particles.floatText(this.x, this.y - this.radius - 6, `${Math.round(amount)}`, "#fff8e6");
        audio.sfxHit();
        if (knockAngle !== null) {
            this.vx += Math.cos(knockAngle) * 180;
            this.vy += Math.sin(knockAngle) * 180;
        }
        if (this.hp <= 0) this.die(world);
    }

    die(world) {
        this.dead = true;
        world.particles.deathBurst(this.x, this.y, this.def.color);
        audio.sfxEnemyDeath();
        world.onEnemyKilled(this);
    }

    _approach(target, dt, speedMult = 1) {
        const a = angleTo(this.x, this.y, target.x, target.y);
        this.vx = Math.cos(a) * this.speed * speedMult;
        this.vy = Math.sin(a) * this.speed * speedMult;
    }

    _integrate(dt, world) {
        if (this.stun > 0) {
            this.stun -= dt;
            this.vx *= 0.9;
            this.vy *= 0.9;
        }
        this.hitFlash = Math.max(0, this.hitFlash - dt);
        this.contactTimer = Math.max(0, this.contactTimer - dt);
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        world.level.collideObstacles(this);
    }

    /** Daño de contacto contra el jugador cuando se solapan (con cooldown propio). */
    maybeTouchDamage(player, world) {
        if (this.contactTimer > 0) return;
        const d = dist(this.x, this.y, player.x, player.y);
        if (d < this.radius + player.radius) {
            const a = angleTo(this.x, this.y, player.x, player.y);
            player.takeDamage(this.damage, world.particles);
            player.vx += Math.cos(a) * 150;
            player.vy += Math.sin(a) * 150;
            this.contactTimer = this.def.contactCd;
        }
    }

    update(dt, world) {
        if (this.stun > 0) { this._integrate(dt, world); return; }
        this._ai(dt, world);
        this._integrate(dt, world);
        this.maybeTouchDamage(world.player, world);
    }

    _ai(dt, world) {
        this._approach(world.player, dt);
    }

    draw(ctx, cam) {
        const [sx, sy] = cam.toScreen(this.x, this.y);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.beginPath();
        ctx.ellipse(0, this.radius * 0.7, this.radius * 0.9, this.radius * 0.35, 0, 0, Math.PI * 2);
        ctx.fill();

        const body = this.hitFlash > 0 ? "#ffffff" : this.def.color;
        ctx.fillStyle = body;
        this._drawShape(ctx);

        if (this.elite) {
            ctx.strokeStyle = "#ffd35c";
            ctx.lineWidth = 2.5;
            ctx.beginPath();
            ctx.arc(0, 0, this.radius + 5, 0, Math.PI * 2);
            ctx.stroke();
        }
        ctx.restore();

        // Barra de vida (solo si está dañado)
        if (this.hp < this.maxHp) {
            const w = this.radius * 2.2;
            ctx.save();
            ctx.translate(sx - w / 2, sy - this.radius - 12);
            ctx.fillStyle = "rgba(0,0,0,0.4)";
            ctx.fillRect(0, 0, w, 4);
            ctx.fillStyle = this.elite ? "#ffd35c" : "#e6544f";
            ctx.fillRect(0, 0, w * clamp(this.hp / this.maxHp, 0, 1), 4);
            ctx.restore();
        }
    }

    _drawShape(ctx) {
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.def.dark;
        ctx.beginPath();
        ctx.arc(this.radius * 0.5, -this.radius * 0.3, this.radius * 0.35, 0, Math.PI * 2);
        ctx.fill();
    }
}

/* Pantera Negra: acecho directo, como la antigua hiena. */
export class Pantera extends Enemy {
    _ai(dt, world) { this._approach(world.player, dt); }
    _drawShape(ctx) {
        ctx.save();
        ctx.rotate(this._heading);
        const r = this.radius;
        const b = this.hitFlash > 0 ? "#ffffff" : this.def.color;
        // Cola
        ctx.strokeStyle = this.def.dark;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, 0);
        ctx.quadraticCurveTo(-r * 1.8, -r * 0.4, -r * 1.4, -r * 1.1);
        ctx.stroke();
        // Patas
        ctx.fillStyle = this.def.dark;
        for (const [px, py] of [[-r * 0.4, -r * 0.7], [-r * 0.4, r * 0.7], [r * 0.55, -r * 0.7], [r * 0.55, r * 0.7]]) {
            ctx.beginPath();
            ctx.ellipse(px, py, r * 0.26, r * 0.4, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        // Cuerpo y cabeza
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.1, r * 0.68, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(r * 0.95, 0, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // Orejas
        ctx.beginPath();
        ctx.arc(r * 0.78, -r * 0.42, r * 0.16, 0, Math.PI * 2);
        ctx.arc(r * 0.78, r * 0.42, r * 0.16, 0, Math.PI * 2);
        ctx.fill();
        // Ojos
        ctx.fillStyle = "#ffd23a";
        ctx.beginPath();
        ctx.arc(r * 1.18, -r * 0.16, 1.6, 0, Math.PI * 2);
        ctx.arc(r * 1.18, r * 0.16, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

/* Mono Aullador: rápido y errático, esquiva de lado mientras se acerca. */
export class Mono extends Enemy {
    constructor(...args) { super(...args); this.jitterT = Math.random() * 10; }
    _ai(dt, world) {
        this.jitterT += dt * 6;
        const a = angleTo(this.x, this.y, world.player.x, world.player.y);
        const perp = a + Math.PI / 2;
        const jitter = Math.sin(this.jitterT) * 0.6;
        this.vx = (Math.cos(a) + Math.cos(perp) * jitter) * this.speed;
        this.vy = (Math.sin(a) + Math.sin(perp) * jitter) * this.speed;
    }
    _drawShape(ctx) {
        ctx.save();
        ctx.rotate(this._heading);
        const r = this.radius;
        const b = this.hitFlash > 0 ? "#ffffff" : this.def.color;
        // Cola enroscada
        ctx.strokeStyle = this.def.dark;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(-r * 0.95, 0, r * 0.5, Math.PI * 0.2, Math.PI * 1.8);
        ctx.stroke();
        // Extremidades
        ctx.fillStyle = this.def.dark;
        for (const [px, py] of [[-r * 0.2, -r * 0.9], [-r * 0.2, r * 0.9], [r * 0.5, -r * 0.8], [r * 0.5, r * 0.8]]) {
            ctx.beginPath();
            ctx.arc(px, py, r * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
        // Cuerpo y cabeza
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 0.85, r * 0.9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.arc(r * 0.55, 0, r * 0.6, 0, Math.PI * 2);
        ctx.fill();
        // Orejas grandes
        ctx.beginPath();
        ctx.arc(r * 0.4, -r * 0.62, r * 0.28, 0, Math.PI * 2);
        ctx.arc(r * 0.4, r * 0.62, r * 0.28, 0, Math.PI * 2);
        ctx.fill();
        // Cara clara y ojos
        ctx.fillStyle = "#e6c9a8";
        ctx.beginPath();
        ctx.arc(r * 0.7, 0, r * 0.36, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#2a1a08";
        ctx.beginPath();
        ctx.arc(r * 0.78, -r * 0.14, 1.5, 0, Math.PI * 2);
        ctx.arc(r * 0.78, r * 0.14, 1.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

/* Rana Venenosa: mantiene la distancia y escupe veneno (peloticas rojas). */
export class Rana extends Enemy {
    _ai(dt, world) {
        const d = dist(this.x, this.y, world.player.x, world.player.y);
        const a = angleTo(this.x, this.y, world.player.x, world.player.y);
        if (d < 240) { this.vx = -Math.cos(a) * this.speed; this.vy = -Math.sin(a) * this.speed; }
        else if (d > 340) { this.vx = Math.cos(a) * this.speed; this.vy = Math.sin(a) * this.speed; }
        else { this.vx *= 0.9; this.vy *= 0.9; }

        this.abilityTimer -= dt;
        if (this.abilityTimer <= 0 && d < 500) {
            this.abilityTimer = randRange(1.6, 2.2);
            const speed = 260;
            // Escupitajo venenoso: al impactar deja al león envenenado.
            world.projectiles.push(new EnemyBolt(this.x, this.y, Math.cos(a) * speed, Math.sin(a) * speed, this.damage, "#ff3b3b", true));
            audio.sfxHit();
        }
    }
    _drawShape(ctx) {
        ctx.save();
        ctx.rotate(this._heading);
        const r = this.radius;
        const b = this.hitFlash > 0 ? "#ffffff" : this.def.color;
        // Patas traseras plegadas
        ctx.fillStyle = this.def.dark;
        ctx.beginPath();
        ctx.ellipse(-r * 0.5, -r * 0.7, r * 0.5, r * 0.3, -0.6, 0, Math.PI * 2);
        ctx.ellipse(-r * 0.5, r * 0.7, r * 0.5, r * 0.3, 0.6, 0, Math.PI * 2);
        ctx.fill();
        // Cuerpo ancho
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.15, r * 0.95, 0, 0, Math.PI * 2);
        ctx.fill();
        // Ojos saltones
        ctx.beginPath();
        ctx.arc(r * 0.7, -r * 0.5, r * 0.34, 0, Math.PI * 2);
        ctx.arc(r * 0.7, r * 0.5, r * 0.34, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#ffd23a";
        ctx.beginPath();
        ctx.arc(r * 0.78, -r * 0.5, r * 0.18, 0, Math.PI * 2);
        ctx.arc(r * 0.78, r * 0.5, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#1a1a1a";
        ctx.beginPath();
        ctx.arc(r * 0.86, -r * 0.5, r * 0.08, 0, Math.PI * 2);
        ctx.arc(r * 0.86, r * 0.5, r * 0.08, 0, Math.PI * 2);
        ctx.fill();
        // Manchas tóxicas
        ctx.fillStyle = "#ffcf3a";
        for (const [px, py] of [[-r * 0.2, -r * 0.3], [r * 0.1, r * 0.35], [-r * 0.55, r * 0.05]]) {
            ctx.beginPath();
            ctx.arc(px, py, r * 0.16, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
    }
}

/* Gorila Plateado: tanque lento que embiste de golpe. */
export class Gorila extends Enemy {
    constructor(...args) { super(...args); this.chargeTimer = randRange(2, 3); this.charging = false; }
    _ai(dt, world) {
        this.chargeTimer -= dt;
        const d = dist(this.x, this.y, world.player.x, world.player.y);
        if (this.chargeTimer <= 0 && d < 420 && !this.charging) {
            this.charging = true;
            this.chargeDur = 0.7;
            this.chargeTimer = randRange(2.5, 3.5);
            const a = angleTo(this.x, this.y, world.player.x, world.player.y);
            this.chargeVx = Math.cos(a) * this.speed * 2.6;
            this.chargeVy = Math.sin(a) * this.speed * 2.6;
        }
        if (this.charging) {
            this.chargeDur -= dt;
            this.vx = this.chargeVx;
            this.vy = this.chargeVy;
            if (this.chargeDur <= 0) this.charging = false;
        } else {
            this._approach(world.player, dt);
        }
    }
    _drawShape(ctx) {
        ctx.save();
        ctx.rotate(this._heading);
        const r = this.radius;
        const b = this.hitFlash > 0 ? "#ffffff" : this.def.color;
        // Brazos
        ctx.fillStyle = this.def.dark;
        ctx.beginPath();
        ctx.ellipse(r * 0.2, -r * 0.95, r * 0.45, r * 0.6, 0, 0, Math.PI * 2);
        ctx.ellipse(r * 0.2, r * 0.95, r * 0.45, r * 0.6, 0, 0, Math.PI * 2);
        ctx.fill();
        // Cuerpo
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.0, r * 0.95, 0, 0, Math.PI * 2);
        ctx.fill();
        // Lomo plateado
        ctx.fillStyle = "#8a8a92";
        ctx.beginPath();
        ctx.ellipse(-r * 0.25, 0, r * 0.5, r * 0.7, 0, 0, Math.PI * 2);
        ctx.fill();
        // Cabeza
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.arc(r * 0.8, 0, r * 0.5, 0, Math.PI * 2);
        ctx.fill();
        // Cara y ojos
        ctx.fillStyle = this.def.dark;
        ctx.beginPath();
        ctx.ellipse(r * 0.92, 0, r * 0.32, r * 0.4, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#d24b4b";
        ctx.beginPath();
        ctx.arc(r * 0.98, -r * 0.14, 1.6, 0, Math.PI * 2);
        ctx.arc(r * 0.98, r * 0.14, 1.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

/* Serpiente Chamán: mantiene distancia, envenena con su anillo y potencia a
 * los demás animales (idéntico rol al antiguo chamán). */
export class Serpiente extends Enemy {
    _ai(dt, world) {
        const d = dist(this.x, this.y, world.player.x, world.player.y);
        const a = angleTo(this.x, this.y, world.player.x, world.player.y);
        if (d < 180) { this.vx = -Math.cos(a) * this.speed; this.vy = -Math.sin(a) * this.speed; }
        else if (d > 260) { this.vx = Math.cos(a) * this.speed; this.vy = Math.sin(a) * this.speed; }
        else { this.vx *= 0.85; this.vy *= 0.85; }

        this.abilityTimer -= dt;
        if (this.abilityTimer <= 0) {
            this.abilityTimer = randRange(4, 5.5);
            world.particles.ring(this.x, this.y, "#9be86a", 240, 0.6);
            // Vaho tóxico: envenena al jugador dentro del anillo y hace aparecer
            // un antídoto en el mapa para que pueda curarse.
            if (world.player.alive && dist(this.x, this.y, world.player.x, world.player.y) < 260) {
                world.player.applyPoison();
                world.spawnCurePickup();
                audio.sfxPoison();
            }
            for (const e of world.enemies) {
                if (e === this) continue;
                const dd = dist(e.x, e.y, this.x, this.y);
                if (dd < 220) e.buffTimer = 3;
            }
        }
    }
    /** El mordisco de contacto de la serpiente también envenena. */
    maybeTouchDamage(player, world) {
        const before = this.contactTimer;
        super.maybeTouchDamage(player, world);
        if (this.contactTimer > before && player.alive) {
            player.applyPoison();
            world.spawnCurePickup();
            audio.sfxPoison();
        }
    }
    update(dt, world) {
        super.update(dt, world);
        if (this.buffTimer > 0) this.buffTimer -= dt;
    }
    _drawShape(ctx) {
        ctx.save();
        ctx.rotate(this._heading);
        const r = this.radius;
        const b = this.hitFlash > 0 ? "#ffffff" : this.def.color;
        const t = performance.now() / 200;
        // Cuerpo serpenteante: segmentos hacia atrás con ondulación
        for (let i = 5; i >= 1; i--) {
            const off = i * r * 0.45;
            const sway = Math.sin(t - i * 0.6) * r * 0.4;
            ctx.fillStyle = i % 2 ? this.def.dark : b;
            ctx.beginPath();
            ctx.arc(-off, sway, r * (0.4 + i * 0.02), 0, Math.PI * 2);
            ctx.fill();
        }
        // Cabeza triangular
        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.moveTo(r * 1.1, 0);
        ctx.lineTo(r * 0.2, -r * 0.6);
        ctx.lineTo(r * 0.2, r * 0.6);
        ctx.closePath();
        ctx.fill();
        // Marca mística
        ctx.fillStyle = "#c79bff";
        ctx.beginPath();
        ctx.arc(r * 0.45, 0, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
        // Ojos
        ctx.fillStyle = "#ffd23a";
        ctx.beginPath();
        ctx.arc(r * 0.6, -r * 0.22, 1.4, 0, Math.PI * 2);
        ctx.arc(r * 0.6, r * 0.22, 1.4, 0, Math.PI * 2);
        ctx.fill();
        // Lengua bífida
        ctx.strokeStyle = "#d24b4b";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(r * 1.1, 0);
        ctx.lineTo(r * 1.5 + Math.sin(t * 3) * 2, 0);
        ctx.stroke();
        ctx.restore();
    }
}

/* Cebra Salvaje: corredora rápida que se aparta del jugador y dispara púas a
 * distancia con un ritmo constante y un golpe punzante suficiente para ser
 * peligrosa, pero esquivable. */
export class Cebra extends Enemy {
    constructor(...args) {
        super(...args);
        this.attackWindup = 0;
    }

    update(dt, world) {
        this.attackWindup = Math.max(0, this.attackWindup - dt);
        super.update(dt, world);
    }

    _ai(dt, world) {
        const d = dist(this.x, this.y, world.player.x, world.player.y);
        const a = angleTo(this.x, this.y, world.player.x, world.player.y);
        const detect = d < 460;

        if (detect) {
            const strafe = Math.sin((this.x + this.y) * 0.04 + performance.now() * 0.0012) * 0.8;
            this.vx = (Math.cos(a) + Math.cos(a + Math.PI / 2) * strafe) * this.speed * (d < 180 ? 1.18 : 1.0);
            this.vy = (Math.sin(a) + Math.sin(a + Math.PI / 2) * strafe) * this.speed * (d < 180 ? 1.18 : 1.0);
            if (d < 120) {
                this.vx = -Math.cos(a) * this.speed * 0.9;
                this.vy = -Math.sin(a) * this.speed * 0.9;
            }
        } else {
            this.vx *= 0.96;
            this.vy *= 0.96;
        }

        this.abilityTimer -= dt;
        if (this.abilityTimer <= 0 && d < 520) {
            this.abilityTimer = randRange(1.25, 1.85);
            const speed = 360 + Math.min(100, d * 0.25);
            const px = this.x + Math.cos(a) * (this.radius + 12);
            const py = this.y + Math.sin(a) * (this.radius + 12);
            world.projectiles.push(new EnemySpike(px, py, Math.cos(a) * speed, Math.sin(a) * speed, this.damage, "#f4d36b"));
            world.particles.ring(this.x, this.y, "#f5d76a", 80, 0.26);
            world.camera.shake(3, 0.08);
            this.attackWindup = 0.18;
            this.vx *= 0.55;
            this.vy *= 0.55;
            audio.sfxHit();
        }
    }

    _drawShape(ctx) {
        ctx.save();
        ctx.rotate(this._heading);
        const r = this.radius;
        const b = this.hitFlash > 0 ? "#ffffff" : this.def.color;
        const strip = this.attackWindup > 0 ? 1 : 0;

        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.ellipse(0, 0, r * 1.15, r * 0.8, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = this.def.dark;
        ctx.beginPath();
        ctx.ellipse(-r * 0.2, -r * 0.22, r * 0.5, r * 0.52, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#2a2a29";
        ctx.lineWidth = 2.5;
        for (let i = -2; i <= 2; i++) {
            const x = i * r * 0.12;
            ctx.beginPath();
            ctx.moveTo(-r * 0.9 + x, -r * 0.72);
            ctx.quadraticCurveTo(x, 0, -r * 0.9 + x, r * 0.7);
            ctx.stroke();
        }

        ctx.fillStyle = b;
        ctx.beginPath();
        ctx.arc(r * 0.9, 0, r * 0.56, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = "#fbf3d7";
        ctx.beginPath();
        ctx.arc(r * 1.18, strip * 0.14, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#2b1f0d";
        ctx.beginPath();
        ctx.arc(r * 1.26, -r * 0.08 + strip * 0.08, 1.9, 0, Math.PI * 2);
        ctx.arc(r * 1.26, r * 0.08 + strip * 0.08, 1.9, 0, Math.PI * 2);
        ctx.fill();

        ctx.fillStyle = this.def.dark;
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, -r * 0.2);
        ctx.lineTo(-r * 1.5, -r * 0.55);
        ctx.lineTo(-r * 1.25, -r * 0.05);
        ctx.closePath();
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-r * 0.9, r * 0.2);
        ctx.lineTo(-r * 1.5, r * 0.55);
        ctx.lineTo(-r * 1.25, r * 0.05);
        ctx.closePath();
        ctx.fill();

        ctx.strokeStyle = this.def.dark;
        ctx.lineWidth = 3;
        for (const [px, py] of [[-r * 0.35, -r * 0.78], [-r * 0.35, r * 0.78], [r * 0.38, -r * 0.75], [r * 0.38, r * 0.75]]) {
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(px + Math.sin((this.x + this.y) * 0.06 + performance.now() * 0.02) * 3, py + r * 0.4);
            ctx.stroke();
        }
        ctx.restore();
    }
}

const CLASSES = { pantera: Pantera, mono: Mono, rana: Rana, gorila: Gorila, serpiente: Serpiente, cebra: Cebra };

export function createEnemy(kind, x, y, elite, difficultyLevel) {
    const Cls = CLASSES[kind] || Enemy;
    return new Cls(x, y, kind, elite, difficultyLevel);
}

/* ------------------------------------------------------------------ */
/* Jefe final: "El Usurpador", un león rival con tres fases.           */
/* ------------------------------------------------------------------ */

export class Boss extends Enemy {
    constructor(x, y, difficultyLevel) {
        super(x, y, "pantera", false, 0); // reutiliza base, luego se sobreescriben stats
        this.kind = "jefe";
        this.def = { color: "#5a1f1f", dark: "#2c0f0f", contactCd: 0.5, name: "El Usurpador" };
        this.radius = 34;
        this.maxHp = 380 + difficultyLevel * 60;
        this.hp = this.maxHp;
        this.speed = 130;
        this.damage = 22;
        this.phase = 1;
        this.chargeTimer = 3;
        this.charging = false;
        this.summonTimer = 6;
        this.roarTimer = 5;
        this.roarWarn = 0;
        this.difficultyLevel = difficultyLevel;
    }

    die(world) {
        this.dead = true;
        world.particles.deathBurst(this.x, this.y, "#5a1f1f");
        world.particles.deathBurst(this.x, this.y, "#ffd35c");
        audio.sfxEnemyDeath();
        world.onBossKilled(this);
    }

    _updatePhase() {
        const ratio = this.hp / this.maxHp;
        this.phase = ratio > 0.66 ? 1 : ratio > 0.33 ? 2 : 3;
    }

    _ai(dt, world) {
        this._updatePhase();
        const player = world.player;
        const d = dist(this.x, this.y, player.x, player.y);
        const a = angleTo(this.x, this.y, player.x, player.y);

        this.chargeTimer -= dt;
        if (this.roarWarn > 0) {
            this.roarWarn -= dt;
            this.vx *= 0.9; this.vy *= 0.9;
            if (this.roarWarn <= 0) {
                world.camera.shake(14, 0.3);
                audio.sfxBossRoar();
                world.particles.ring(this.x, this.y, "#ff8a6b", 260, 0.6);
                const dd = dist(this.x, this.y, player.x, player.y);
                if (dd < 260) {
                    player.takeDamage(this.damage * 0.6, world.particles);
                    const pa = angleTo(this.x, this.y, player.x, player.y);
                    player.vx += Math.cos(pa) * 380;
                    player.vy += Math.sin(pa) * 380;
                }
            }
            return;
        }

        if (this.charging) {
            this.chargeDur -= dt;
            this.vx = this.chargeVx;
            this.vy = this.chargeVy;
            if (this.chargeDur <= 0) this.charging = false;
            return;
        }

        if (this.chargeTimer <= 0 && d < 500) {
            this.charging = true;
            this.chargeDur = 0.55;
            this.chargeTimer = this.phase >= 3 ? randRange(1.6, 2.2) : randRange(2.4, 3.2);
            this.chargeVx = Math.cos(a) * this.speed * 3.1;
            this.chargeVy = Math.sin(a) * this.speed * 3.1;
            world.camera.shake(4, 0.1);
            return;
        }

        if (this.phase >= 2) {
            this.summonTimer -= dt;
            if (this.summonTimer <= 0) {
                this.summonTimer = randRange(6, 8);
                for (let i = 0; i < 2; i++) {
                    const ang = Math.random() * Math.PI * 2;
                    world.enemies.push(createEnemy("pantera", this.x + Math.cos(ang) * 60, this.y + Math.sin(ang) * 60, false, this.difficultyLevel));
                }
            }
        }
        if (this.phase >= 3) {
            this.roarTimer -= dt;
            if (this.roarTimer <= 0) {
                this.roarTimer = randRange(5, 7);
                this.roarWarn = 0.6;
                world.particles.ring(this.x, this.y, "#ff8a6b", 60, 0.6);
            }
        }

        const speedMult = this.phase >= 3 ? 1.2 : 1;
        this.vx = Math.cos(a) * this.speed * speedMult;
        this.vy = Math.sin(a) * this.speed * speedMult;
    }

    _drawShape(ctx) {
        const enrage = this.phase >= 3;
        ctx.fillStyle = enrage ? "#7a1f1f" : this.def.dark;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius * 1.35, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = this.hitFlash > 0 ? "#ffffff" : this.def.color;
        ctx.beginPath();
        ctx.arc(0, 0, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = enrage ? "#ffb347" : "#ff5c5c";
        ctx.beginPath();
        ctx.arc(-this.radius * 0.3, -this.radius * 0.2, 3, 0, Math.PI * 2);
        ctx.arc(this.radius * 0.3, -this.radius * 0.2, 3, 0, Math.PI * 2);
        ctx.fill();
        if (this.roarWarn > 0) {
            ctx.strokeStyle = "#ff8a6b";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, this.radius + 12 + Math.sin(performance.now() / 30) * 4, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}
