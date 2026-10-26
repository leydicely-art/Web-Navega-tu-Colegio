/* Proyectiles: el zarpazo del león (atraviesa un enemigo) y los disparos de
 * enemigos a distancia (rana venenosa, serpiente chamán). */

import { Entity } from "./engine.js";

export class EnemySpike extends Entity {
    constructor(x, y, vx, vy, damage, color = "#f4d36b") {
        super(x, y, 6);
        this.vx = vx;
        this.vy = vy;
        this.damage = damage;
        this.color = color;
        this.life = 2.6;
        this.kind = "spike";
    }

    update(dt, level) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        if (this.life <= 0) this.dead = true;
        for (const o of level.obstacles) {
            const d = Math.hypot(this.x - o.x, this.y - o.y);
            if (d < o.radius + this.radius) { this.dead = true; break; }
        }
    }

    draw(ctx, cam) {
        const [sx, sy] = cam.toScreen(this.x, this.y);
        const angle = Math.atan2(this.vy, this.vx);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(angle);
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.moveTo(10, 0);
        ctx.lineTo(-8, -4);
        ctx.lineTo(-4, 0);
        ctx.lineTo(-8, 4);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(80, 54, 12, 0.7)";
        ctx.fillRect(-9, -1.4, 10, 2.8);
        ctx.restore();
    }
}

export class ClawShot extends Entity {
    constructor(x, y, vx, vy, owner, damage, pierce, maxRange) {
        super(x, y, 8);
        this.vx = vx;
        this.vy = vy;
        this.owner = owner;
        this.damage = damage;
        this.pierce = pierce;
        this.traveled = 0;
        this.maxRange = maxRange;
        this.hitSet = new Set();
        this.kind = "claw";
    }

    update(dt, level) {
        const dx = this.vx * dt, dy = this.vy * dt;
        this.x += dx;
        this.y += dy;
        this.traveled += Math.hypot(dx, dy);
        if (this.traveled >= this.maxRange) this.dead = true;
        for (const o of level.obstacles) {
            const d = Math.hypot(this.x - o.x, this.y - o.y);
            if (d < o.radius) { this.dead = true; break; }
        }
        if (this.x < 0 || this.y < 0 || this.x > level.width || this.y > level.height) this.dead = true;
    }

    draw(ctx, cam) {
        const [sx, sy] = cam.toScreen(this.x, this.y);
        const angle = Math.atan2(this.vy, this.vx);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(angle);
        ctx.strokeStyle = "#fff3c4";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-10, -6);
        ctx.lineTo(10, 0);
        ctx.moveTo(-10, 0);
        ctx.lineTo(12, 0);
        ctx.moveTo(-10, 6);
        ctx.lineTo(10, 0);
        ctx.stroke();
        ctx.restore();
    }
}

export class EnemyBolt extends Entity {
    constructor(x, y, vx, vy, damage, color = "#ff3b3b", poison = false) {
        super(x, y, 7);
        this.vx = vx;
        this.vy = vy;
        this.damage = damage;
        this.color = color;
        this.poison = poison; // si true, envenena al león al impactar
        this.life = 3;
        this.kind = "bolt";
    }

    update(dt, level) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        this.life -= dt;
        if (this.life <= 0) this.dead = true;
        for (const o of level.obstacles) {
            const d = Math.hypot(this.x - o.x, this.y - o.y);
            if (d < o.radius) { this.dead = true; break; }
        }
    }

    draw(ctx, cam) {
        const [sx, sy] = cam.toScreen(this.x, this.y);
        if (this.poison) {
            ctx.save();
            ctx.globalAlpha = 0.4;
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(sx, sy, this.radius + 4, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(sx, sy, this.radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = 1.5;
        ctx.stroke();
    }
}
