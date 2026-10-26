/* Sistema de partículas y texto flotante (daño, curación, monedas) para el feedback
 * visual de golpes, muertes, habilidades y recolección de objetos. */

import { randRange } from "./engine.js";

class Particle {
    constructor(x, y, vx, vy, life, size, color, opts = {}) {
        this.x = x; this.y = y;
        this.vx = vx; this.vy = vy;
        this.life = life; this.maxLife = life;
        this.size = size;
        this.color = color;
        this.gravity = opts.gravity ?? 0;
        this.friction = opts.friction ?? 0.94;
        this.shrink = opts.shrink ?? true;
        this.text = opts.text ?? null;
        this.ring = opts.ring ?? false;
    }
}

export class ParticleSystem {
    constructor() {
        this.particles = [];
    }

    spawn(x, y, vx, vy, life, size, color, opts) {
        this.particles.push(new Particle(x, y, vx, vy, life, size, color, opts));
    }

    /** Chispas de impacto al golpear un enemigo (o al jugador recibir daño). */
    hitSpark(x, y, color = "#fff3c4") {
        for (let i = 0; i < 8; i++) {
            const a = randRange(0, Math.PI * 2);
            const speed = randRange(60, 200);
            this.spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed, randRange(0.15, 0.3), randRange(2, 4), color, { friction: 0.88 });
        }
    }

    /** "Pelusa"/polvo al recibir o dar golpes — sustituye a la sangre, más acorde a un juego familiar. */
    furPuff(x, y, color = "#caa46b") {
        for (let i = 0; i < 6; i++) {
            const a = randRange(0, Math.PI * 2);
            const speed = randRange(20, 90);
            this.spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed - 30, randRange(0.4, 0.7), randRange(3, 6), color, { gravity: 140, friction: 0.96 });
        }
    }

    deathBurst(x, y, color = "#caa46b") {
        for (let i = 0; i < 16; i++) {
            const a = randRange(0, Math.PI * 2);
            const speed = randRange(80, 260);
            this.spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed, randRange(0.3, 0.6), randRange(3, 7), color, { friction: 0.9 });
        }
    }

    dashTrail(x, y, color = "#f3d99a") {
        this.spawn(x, y, randRange(-10, 10), randRange(-10, 10), 0.25, randRange(6, 10), color, { friction: 0.9, shrink: true });
    }

    ring(x, y, color = "#ffe08a", maxRadius = 160, life = 0.5) {
        this.particles.push(new Particle(x, y, 0, 0, life, maxRadius, color, { ring: true, shrink: false }));
    }

    sparkle(x, y, color = "#ffd35c") {
        for (let i = 0; i < 10; i++) {
            const a = randRange(0, Math.PI * 2);
            const speed = randRange(20, 80);
            this.spawn(x, y, Math.cos(a) * speed, Math.sin(a) * speed - 40, randRange(0.4, 0.8), randRange(2, 4), color, { gravity: 60, friction: 0.95 });
        }
    }

    /** Número flotante (daño, curación...). */
    floatText(x, y, text, color = "#fff") {
        this.particles.push(new Particle(x, y, randRange(-15, 15), -70, 0.8, 16, color, { text, gravity: 40, friction: 0.98, shrink: false }));
    }

    update(dt) {
        for (const p of this.particles) {
            p.life -= dt;
            p.vx *= p.friction;
            p.vy *= p.friction;
            p.vy += p.gravity * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
        }
        this.particles = this.particles.filter((p) => p.life > 0);
    }

    draw(ctx, cam) {
        for (const p of this.particles) {
            const [sx, sy] = cam.toScreen(p.x, p.y);
            const t = Math.max(0, p.life / p.maxLife);
            ctx.save();
            ctx.globalAlpha = t;
            if (p.ring) {
                const r = p.size * (1 - t) + 4;
                ctx.strokeStyle = p.color;
                ctx.lineWidth = 4 * t + 1;
                ctx.beginPath();
                ctx.arc(sx, sy, r, 0, Math.PI * 2);
                ctx.stroke();
            } else if (p.text) {
                ctx.fillStyle = p.color;
                ctx.font = `bold ${p.size}px 'Nunito', sans-serif`;
                ctx.textAlign = "center";
                ctx.fillText(p.text, sx, sy);
            } else {
                const size = p.shrink ? p.size * t : p.size;
                ctx.fillStyle = p.color;
                ctx.beginPath();
                ctx.arc(sx, sy, Math.max(0.5, size), 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
        }
    }
}
