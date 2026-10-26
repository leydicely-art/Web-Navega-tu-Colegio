/* El protagonista: un león aventurero. Movimiento en 4 direcciones, apuntado
 * con el mouse, zarpazo a distancia, salto felino (dash) y rugido (habilidad
 * de área). Todo el arte es procedural (canvas), sin sprites externos. */

import { Entity, clamp, angleTo } from "./engine.js";
import { ClawShot } from "./projectiles.js";
import { audio } from "./audio.js";

// Veneno: daño leve y espaciado, para que no fulmine al león mientras busca el antídoto.
const POISON_INTERVAL = 2;   // segundos entre pinchazos de daño
const POISON_DAMAGE = 2;     // vida perdida por pinchazo

const BASE_STATS = {
    maxHealth: 100,
    speed: 230,
    damage: 16,
    attackCooldown: 0.32,
    attackRange: 520,
    dashCooldown: 1.4,
    dashDuration: 0.18,
    dashSpeed: 720,
    roarCooldown: 7,
    roarRadius: 190,
    roarStun: 1.4,
};

export class Lion extends Entity {
    constructor(x, y, bonuses) {
        super(x, y, 20);
        this.bonuses = bonuses;
        this.maxHealth = BASE_STATS.maxHealth + bonuses.maxHealthBonus;
        this.health = this.maxHealth;
        this.speed = BASE_STATS.speed * bonuses.speedMult;
        this.damage = BASE_STATS.damage * bonuses.damageMult;
        this.attackRange = BASE_STATS.attackRange * bonuses.rangeMult;
        this.attackCooldown = BASE_STATS.attackCooldown * bonuses.cooldownMult;
        this.dashCooldown = BASE_STATS.dashCooldown * bonuses.cooldownMult;
        this.roarCooldown = BASE_STATS.roarCooldown * bonuses.cooldownMult;
        this.roarRadius = BASE_STATS.roarRadius * bonuses.roarMult;

        this.facing = 0;
        this.attackTimer = 0;
        this.dashTimer = 0;
        this.dashCdTimer = 0;
        this.dashing = false;
        this.roarCdTimer = 0;
        this.roarFx = 0; // tiempo restante del anillo visual del rugido
        this.invuln = 0;
        this.hurtFlash = 0;
        this.poisonTime = 0;   // segundos restantes de veneno
        this.poisonTick = 0;   // temporizador hasta el próximo pinchazo de daño
        this.state = "idle";
        this.animT = 0;
        this.alive = true;
        this.invMass = 1;
    }

    get dashReady() { return this.dashCdTimer <= 0; }
    get roarReady() { return this.roarCdTimer <= 0; }

    takeDamage(amount, particles) {
        if (this.invuln > 0 || !this.alive) return;
        this.health -= amount;
        this.invuln = 0.6;
        this.hurtFlash = 0.25;
        this.state = "hurt";
        audio.sfxPlayerHurt();
        particles.furPuff(this.x, this.y, "#e8d9b0");
        particles.floatText(this.x, this.y - 30, `-${Math.round(amount)}`, "#ff6b6b");
        if (this.health <= 0) {
            this.health = 0;
            this.alive = false;
            this.state = "dead";
        }
    }

    heal(amount, particles) {
        this.health = clamp(this.health + amount, 0, this.maxHealth);
        particles.floatText(this.x, this.y - 30, `+${Math.round(amount)}`, "#7fd88f");
    }

    get poisoned() { return this.poisonTime > 0; }

    /** Aplica (o refresca) el veneno. El daño se cura recogiendo el antídoto. */
    applyPoison(seconds = 8) {
        if (!this.alive) return;
        const wasClean = this.poisonTime <= 0;
        this.poisonTime = Math.max(this.poisonTime, seconds);
        if (wasClean) this.poisonTick = POISON_INTERVAL;
    }

    /** Recoger el antídoto elimina el veneno y devuelve algo de vida. */
    curePoison(particles) {
        this.poisonTime = 0;
        this.poisonTick = 0;
        if (particles) particles.floatText(this.x, this.y - 30, "¡Curado!", "#7fd88f");
    }

    _tickPoison(dt, world) {
        if (this.poisonTime <= 0) return;
        this.poisonTime -= dt;
        this.poisonTick -= dt;
        if (this.poisonTick <= 0) {
            this.poisonTick = POISON_INTERVAL;
            this.health -= POISON_DAMAGE;
            world.particles.furPuff(this.x, this.y, "#8ce68c");
            world.particles.floatText(this.x, this.y - 24, `-${POISON_DAMAGE}`, "#8ce68c");
            if (this.health <= 0) {
                this.health = 0;
                this.alive = false;
                this.state = "dead";
            }
        }
        if (this.poisonTime <= 0) this.poisonTick = 0;
    }

    tryAttack(input, world) {
        if (this.attackTimer > 0 || !this.alive) return;
        this.attackTimer = this.attackCooldown;
        this.state = "attack";
        this.animT = 0;
        const [wx, wy] = world.camera.toWorld(input.mouse.x, input.mouse.y);
        this.facing = angleTo(this.x, this.y, wx, wy);
        const speed = 640;
        const shot = new ClawShot(
            this.x + Math.cos(this.facing) * 26,
            this.y + Math.sin(this.facing) * 26,
            Math.cos(this.facing) * speed,
            Math.sin(this.facing) * speed,
            "player", this.damage, 2, this.attackRange
        );
        world.projectiles.push(shot);
        audio.sfxAttack();
    }

    tryDash(moveDir) {
        if (!this.dashReady || this.dashing || !this.alive) return;
        this.dashing = true;
        this.dashTimer = BASE_STATS.dashDuration;
        this.dashCdTimer = this.dashCooldown;
        this.invuln = Math.max(this.invuln, BASE_STATS.dashDuration + 0.05);
        this.state = "dash";
        const hasDir = moveDir.x !== 0 || moveDir.y !== 0;
        this.dashDirX = hasDir ? moveDir.x : Math.cos(this.facing);
        this.dashDirY = hasDir ? moveDir.y : Math.sin(this.facing);
        audio.sfxDash();
    }

    tryRoar(world) {
        if (!this.roarReady || !this.alive) return;
        this.roarCdTimer = this.roarCooldown;
        this.roarFx = 0.5;
        this.state = "roar";
        this.animT = 0;
        audio.sfxRoar();
        world.camera.shake(10, 0.25);
        world.particles.ring(this.x, this.y, "#ffe08a", this.roarRadius, 0.5);
        for (const e of world.enemies) {
            const dx = e.x - this.x, dy = e.y - this.y;
            const d = Math.hypot(dx, dy) || 1;
            if (d <= this.roarRadius) {
                const push = (1 - d / this.roarRadius) * 420 + 120;
                e.vx += (dx / d) * push;
                e.vy += (dy / d) * push;
                e.stun = Math.max(e.stun || 0, BASE_STATS.roarStun);
            }
        }

        // El rugido arranca los arbustos cercanos: abre huecos en los setos.
        const obs = world.level && world.level.obstacles;
        if (obs) {
            let removed = 0;
            world.level.obstacles = obs.filter((o) => {
                if (o.border) return true; // el borde del mapa no se puede arrancar
                const d = Math.hypot(o.x - this.x, o.y - this.y);
                if (d <= this.roarRadius + o.radius) {
                    world.particles.furPuff(o.x, o.y, "#3aa029");
                    world.particles.sparkle(o.x, o.y, "#5fc23a");
                    removed++;
                    return false;
                }
                return true;
            });
            if (removed > 0) audio.sfxHit();
        }
        return true;
    }

    update(dt, input, world) {
        if (!this.alive) {
            this.animT += dt;
            return;
        }

        this.attackTimer = Math.max(0, this.attackTimer - dt);
        this.dashCdTimer = Math.max(0, this.dashCdTimer - dt);
        this.roarCdTimer = Math.max(0, this.roarCdTimer - dt);
        this.invuln = Math.max(0, this.invuln - dt);
        this.hurtFlash = Math.max(0, this.hurtFlash - dt);
        this.roarFx = Math.max(0, this.roarFx - dt);
        this._tickPoison(dt, world);
        if (!this.alive) return;

        const move = input.moveVector();

        if (input.wasPressed("dash")) this.tryDash(move);
        if (input.wasPressed("roar")) this.tryRoar(world);
        if (input.mouse.down) this.tryAttack(input, world);

        if (this.dashing) {
            this.dashTimer -= dt;
            this.vx = this.dashDirX * BASE_STATS.dashSpeed;
            this.vy = this.dashDirY * BASE_STATS.dashSpeed;
            world.particles.dashTrail(this.x, this.y);
            if (this.dashTimer <= 0) this.dashing = false;
        } else {
            this.vx = move.x * this.speed;
            this.vy = move.y * this.speed;
            if ((move.x !== 0 || move.y !== 0)) {
                this.facing = Math.atan2(move.y, move.x);
            }
        }

        this.x += this.vx * dt;
        this.y += this.vy * dt;
        world.level.collideObstacles(this);

        // Recupera el estado visual "idle/walk" cuando no hay una animación activa en curso.
        if (!this.dashing && this.state !== "attack" && this.state !== "hurt" && this.state !== "roar") {
            this.state = (move.x !== 0 || move.y !== 0) ? "walk" : "idle";
        }
        this.animT += dt;
        if (this.state === "attack" && this.animT > 0.18) this.state = "walk";
        if (this.state === "hurt" && this.animT > 0.3) this.state = "walk";
        if (this.state === "roar" && this.animT > 0.4) this.state = "walk";
    }

    draw(ctx, cam) {
        const [sx, sy] = cam.toScreen(this.x, this.y);
        const walking = this.state === "walk";
        const legPhase = walking ? Math.sin(this.animT * 12) : 0;
        const bob = walking ? Math.abs(Math.sin(this.animT * 12)) * 3 : (this.state === "idle" ? Math.sin(this.animT * 2) * 1.5 : 0);

        ctx.save();
        ctx.translate(sx, sy - bob);
        if (!this.alive) {
            ctx.rotate(Math.PI / 2);
            ctx.globalAlpha = 0.9;
        }
        if (this.invuln > 0 && this.alive) {
            ctx.globalAlpha = 0.55 + Math.sin(performance.now() / 40) * 0.2;
        }

        const bodyColor = this.hurtFlash > 0 ? "#ffb3b3" : (this.poisonTime > 0 ? "#9fce6a" : "#d9a441");

        // Aura verdosa mientras dura el veneno
        if (this.poisonTime > 0 && this.alive) {
            ctx.save();
            ctx.globalAlpha = 0.25 + Math.sin(performance.now() / 120) * 0.12;
            ctx.strokeStyle = "#7fd83a";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, 26, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
        const maneColor = this.state === "roar" ? "#ffcf6b" : "#8a5a1f";

        // Sombra
        ctx.fillStyle = "rgba(0,0,0,0.22)";
        ctx.beginPath();
        ctx.ellipse(0, 22, 22, 8, 0, 0, Math.PI * 2);
        ctx.fill();

        // Cola
        const tailWag = Math.sin(this.animT * 6) * 0.5;
        ctx.strokeStyle = bodyColor;
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.moveTo(-16 * Math.cos(this.facing), -16 * Math.sin(this.facing) * 0 - 2);
        const tx = -Math.cos(this.facing) * 26, ty = -Math.sin(this.facing) * 10 + tailWag * 14;
        ctx.quadraticCurveTo(tx, ty - 10, tx - 6, ty - 4);
        ctx.stroke();

        // Patas (4 óvalos animados)
        ctx.fillStyle = "#7a5321";
        for (let i = 0; i < 4; i++) {
            const side = i < 2 ? -1 : 1;
            const front = i % 2 === 0 ? -1 : 1;
            const phase = legPhase * (front > 0 ? 1 : -1);
            ctx.beginPath();
            ctx.ellipse(front * 10, side * 8 + phase * 4, 5, 9, 0, 0, Math.PI * 2);
            ctx.fill();
        }

        // Melena (más grande e iluminada al rugir)
        const maneScale = this.state === "roar" ? 1.35 : 1;
        ctx.fillStyle = maneColor;
        ctx.beginPath();
        ctx.arc(Math.cos(this.facing) * 12, Math.sin(this.facing) * 12, 19 * maneScale, 0, Math.PI * 2);
        ctx.fill();

        // Cuerpo
        ctx.fillStyle = bodyColor;
        ctx.beginPath();
        ctx.ellipse(0, 0, 20, 15, 0, 0, Math.PI * 2);
        ctx.fill();

        // Cabeza (orientada hacia el punto de mira)
        ctx.save();
        ctx.translate(Math.cos(this.facing) * 16, Math.sin(this.facing) * 16);
        ctx.rotate(this.facing);
        ctx.fillStyle = "#e8bd6d";
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();
        // Orejas
        ctx.fillStyle = "#8a5a1f";
        ctx.beginPath(); ctx.arc(-6, -9, 4, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(-6, 9, 4, 0, Math.PI * 2); ctx.fill();
        // Hocico
        const mouthOpen = this.state === "attack" || this.state === "roar";
        ctx.fillStyle = "#fff3d9";
        ctx.beginPath();
        ctx.ellipse(9, 0, 6, mouthOpen ? 6 : 4, 0, 0, Math.PI * 2);
        ctx.fill();
        if (mouthOpen) {
            ctx.fillStyle = "#7a1f1f";
            ctx.beginPath();
            ctx.ellipse(11, 0, 3.5, 4, 0, 0, Math.PI * 2);
            ctx.fill();
        }
        // Ojo
        ctx.fillStyle = "#2a1a08";
        ctx.beginPath();
        ctx.arc(4, -5, 1.8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Zarpa al atacar
        if (this.state === "attack") {
            ctx.strokeStyle = "#fff3c4";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(Math.cos(this.facing) * 24, Math.sin(this.facing) * 24, 14, this.facing - 0.7, this.facing + 0.7);
            ctx.stroke();
        }

        ctx.restore();

        // Anillo del rugido
        if (this.roarFx > 0) {
            ctx.save();
            ctx.globalAlpha = this.roarFx / 0.5 * 0.6;
            ctx.strokeStyle = "#ffe08a";
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(sx, sy, this.roarRadius * (1 - this.roarFx / 0.5), 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }
}
