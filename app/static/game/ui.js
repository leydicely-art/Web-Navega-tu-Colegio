
/* Capa de interfaz (HUD, minimapa y pantallas) para Rugido Salvaje.
 * Gestiona las pantallas, los controles, el HUD y los desafíos educativos.
 */

import { PERMANENT_UPGRADES, upgradeCost } from "./save.js";

const el = (id) => document.getElementById(id);

const ids = [
    "gameStage", "hud", "hudHealthFill", "hudHealthText", "hudCoins", "hudGems",
    "hudZoneName", "hudWaveInfo", "hudPoison", "hudDashBar", "hudRoarBar", "hudMinimap",
    "screenStart", "btnPlay", "btnUpgradesOpen",
    "screenUpgrades", "upgradesGems", "upgradesList", "btnUpgradesBack",
    "screenPause", "btnResume", "btnRestartFromPause", "btnExitFromPause",
    "screenShop", "shopCoins", "shopList", "btnShopContinue", "shopZoneNext",
    "screenGameOver", "gameOverStats", "btnRetry", "btnMenuFromGameOver",
    "screenVictory", "victoryStats", "btnPlayAgain", "btnMenuFromVictory",
    "screenIntro", "introZoneName", "introZoneDesc", "btnIntroContinue",
    "screenChallenge", "challengePanel", "challengeTitle", "challengeQuestion",
    "challengeOptions", "challengeInfo", "challengeFeedback", "challengeReaction",
    "btnChallengeContinue"
];

const els = {};
// Identifica si el reto actual es automático o pertenece a un portal.
let currentChallengeType = "timed";

export function initUI(callbacks) {
    for (const id of ids) {
        els[id] = el(id);
    }

    // Controles del menú y las mejoras.
    els.btnPlay?.addEventListener("click", () => callbacks.onPlay());
    els.btnUpgradesOpen?.addEventListener("click", () => callbacks.onOpenUpgrades());
    els.btnUpgradesBack?.addEventListener("click", () => callbacks.onCloseUpgrades());

    // Controles de pausa.
    els.btnResume?.addEventListener("click", () => callbacks.onResume());
    els.btnRestartFromPause?.addEventListener("click", () => callbacks.onRestart());
    els.btnExitFromPause?.addEventListener("click", () => callbacks.onExitToMenu());

    // Tienda e introducción de zona.
    els.btnShopContinue?.addEventListener("click", () => callbacks.onShopContinue());
    els.btnIntroContinue?.addEventListener("click", () => callbacks.onIntroContinue());

    // Derrota y victoria.
    els.btnRetry?.addEventListener("click", () => callbacks.onRestart());
    els.btnMenuFromGameOver?.addEventListener("click", () => callbacks.onExitToMenu());
    els.btnPlayAgain?.addEventListener("click", () => callbacks.onRestart());
    els.btnMenuFromVictory?.addEventListener("click", () => callbacks.onExitToMenu());

   els.btnChallengeContinue?.addEventListener("click", () => {
    callbacks.onChallengeContinue?.(currentChallengeType);
});

    // Teclas de pausa.
    document.addEventListener("keydown", (e) => {
        if (e.code === "Escape" || e.code === "KeyP") {
            callbacks.onPauseKey();
        }
    });
}

const SCREENS = [
    "screenStart",
    "screenUpgrades",
    "screenPause",
    "screenShop",
    "screenGameOver",
    "screenVictory",
    "screenIntro",
    "screenChallenge"
];

export function showScreen(name) {
    for (const screen of SCREENS) {
        if (els[screen]) {
            els[screen].hidden = screen !== name;
        }
    }
}

export function hideAllScreens() {
    for (const screen of SCREENS) {
        if (els[screen]) els[screen].hidden = true;
    }
}

export function setHudVisible(visible) {
    if (els.hud) els.hud.hidden = !visible;
}

export function updateHud(world, zoneName, waveLabel) {
    const p = world.player;
    const pct = Math.max(0, p.health / p.maxHealth) * 100;

    els.hudHealthFill.style.width = `${pct}%`;
    els.hudHealthFill.classList.toggle("is-low", pct < 30);
    els.hudHealthText.textContent =
        `${Math.max(0, Math.round(p.health))} / ${Math.round(p.maxHealth)}`;

    els.hudCoins.textContent = world.runCoins;
    els.hudGems.textContent = world.runGems;
    els.hudZoneName.textContent = zoneName;
    els.hudWaveInfo.textContent = waveLabel;

    if (els.hudPoison) {
        els.hudPoison.hidden = !p.poisoned;
    }

    const dashPct = p.dashReady
        ? 100
        : Math.max(0, 100 - (p.dashCdTimer / p.dashCooldown) * 100);

    const roarPct = p.roarReady
        ? 100
        : Math.max(0, 100 - (p.roarCdTimer / p.roarCooldown) * 100);

    els.hudDashBar.style.setProperty("--pct", `${dashPct}%`);
    els.hudDashBar.classList.toggle("is-ready", p.dashReady);

    els.hudRoarBar.style.setProperty("--pct", `${roarPct}%`);
    els.hudRoarBar.classList.toggle("is-ready", p.roarReady);
}

export function drawMinimap(world) {
    const canvas = els.hudMinimap;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    const w = canvas.width;
    const h = canvas.height;

    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = "rgba(20, 14, 8, 0.55)";
    ctx.fillRect(0, 0, w, h);

    const data = world.getMinimapData();
    const sx = w / data.width;
    const sy = h / data.height;

    if (data.portal) {
        ctx.fillStyle = data.portal.active ? "#ffd35c" : "#6b5a3a";
        ctx.beginPath();
        ctx.arc(data.portal.x * sx, data.portal.y * sy, 4, 0, Math.PI * 2);
        ctx.fill();
    }

    for (const c of data.cures || []) {
        const cx = c.x * sx;
        const cy = c.y * sy;
        const pulse = 0.55 + Math.sin(performance.now() / 200) * 0.45;

        ctx.globalAlpha = 0.4 + 0.5 * pulse;
        ctx.fillStyle = "#ff4d4d";
        ctx.beginPath();
        ctx.arc(cx, cy, 6 + pulse * 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;

        ctx.fillStyle = "#ff3b3b";
        ctx.fillRect(cx - 6.5, cy - 2.2, 13, 4.4);
        ctx.fillRect(cx - 2.2, cy - 6.5, 4.4, 13);

        ctx.fillStyle = "#ffffff";
        ctx.fillRect(cx - 6.5, cy - 1, 13, 2);
        ctx.fillRect(cx - 1, cy - 6.5, 2, 13);
    }

    ctx.globalAlpha = 1;

    for (const enemy of data.enemies) {
        ctx.fillStyle = enemy.boss
            ? "#ff5c5c"
            : enemy.elite
                ? "#ffd35c"
                : "#e07a5f";

        ctx.beginPath();
        ctx.arc(
            enemy.x * sx,
            enemy.y * sy,
            enemy.boss ? 4 : 2.2,
            0,
            Math.PI * 2
        );
        ctx.fill();
    }

    ctx.fillStyle = "#fff3c4";
    ctx.beginPath();
    ctx.arc(data.player.x * sx, data.player.y * sy, 3.2, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
}

export function renderUpgrades(save, onBuy) {
    els.upgradesGems.textContent = save.gems;
    els.upgradesList.innerHTML = "";

    for (const def of PERMANENT_UPGRADES) {
        const level = save.upgrades[def.key] || 0;
        const maxed = level >= def.maxLevel;
        const cost = maxed ? null : upgradeCost(def, level);

        const row = document.createElement("div");
        row.className = "shop-item";

        row.innerHTML = `
            <span class="shop-item__icon">${def.icon}</span>
            <div class="shop-item__body">
                <strong>${def.label}</strong>
                <small>${def.desc} · Nivel ${level}/${def.maxLevel}</small>
            </div>
            <button type="button" class="shop-item__buy"
                ${maxed || save.gems < cost ? "disabled" : ""}>
                ${maxed ? "Máx." : `💎 ${cost}`}
            </button>`;

        row.querySelector("button").addEventListener("click", () => {
            onBuy(def.key);
        });

        els.upgradesList.appendChild(row);
    }
}

export function renderShop(runCoins, purchasedFlags, onBuy, zoneNextName) {
    els.shopCoins.textContent = runCoins;
    els.shopZoneNext.textContent = zoneNextName;

    const OPTIONS = [
        {
            key: "heal",
            icon: "❤️",
            label: "Curación completa",
            desc: "Restaura toda tu vida",
            cost: 3,
            repeatable: true
        },
        {
            key: "damage",
            icon: "🗡️",
            label: "Filo de caza",
            desc: "+15% de daño por esta partida",
            cost: 4,
            repeatable: false
        },
        {
            key: "speed",
            icon: "💨",
            label: "Viento de sabana",
            desc: "+10% de velocidad por esta partida",
            cost: 4,
            repeatable: false
        },
        {
            key: "cooldown",
            icon: "🌬️",
            label: "Aliento renovado",
            desc: "-15% de reutilización por esta partida",
            cost: 5,
            repeatable: false
        }
    ];

    els.shopList.innerHTML = "";

    for (const opt of OPTIONS) {
        const already = purchasedFlags[opt.key] && !opt.repeatable;
        const btn = document.createElement("button");

        btn.type = "button";
        btn.className = "shop-item";
        btn.disabled = already || runCoins < opt.cost;

        btn.innerHTML = `
            <span class="shop-item__icon">${opt.icon}</span>
            <div class="shop-item__body">
                <strong>${opt.label}</strong>
                <small>${opt.desc}</small>
            </div>
            <span class="shop-item__buy">
                ${already ? "Comprado" : `🪙 ${opt.cost}`}
            </span>`;

        btn.addEventListener("click", () => onBuy(opt));
        els.shopList.appendChild(btn);
    }
}

export function setIntroText(name, desc) {
    els.introZoneName.textContent = name;
    els.introZoneDesc.textContent = desc;
}

export function setGameOverStats(stats) {
    els.gameOverStats.innerHTML = `
        <div><strong>${stats.zoneName}</strong></div>
        <div>Enemigos derrotados: ${stats.kills}</div>
        <div>Monedas recogidas: ${stats.coins}</div>
        <div>Gemas recogidas: ${stats.gems}</div>`;
}

export function setVictoryStats(stats) {
    els.victoryStats.innerHTML = `
        <div>Enemigos derrotados: ${stats.kills}</div>
        <div>Monedas recogidas: ${stats.coins}</div>
        <div>Gemas recogidas: ${stats.gems}</div>
        <div>Tiempo total: ${stats.time}</div>`;
}

/**
 * Muestra un desafío educativo y comprueba la respuesta seleccionada.
 * onSolved se ejecuta una sola vez cuando el jugador acierta.
 */
function spawnChallengeMood(mood) {
    const reaction = els.challengeReaction;
    if (!reaction) return;

    reaction.innerHTML = "";
    reaction.classList.remove("is-correct", "is-incorrect");
    reaction.classList.add(mood === "correct" ? "is-correct" : "is-incorrect");

    const emojis = mood === "correct"
        ? ["😀", "😄", "😊", "😁", "🙂", "😃"]
        : ["😟", "🙁", "😢", "😕", "☹️", "😞"];

    for (let i = 0; i < emojis.length; i += 1) {
        const face = document.createElement("span");
        face.className = "challenge-reaction__emoji";
        face.textContent = emojis[i];
        face.style.left = `${18 + ((i % 3) * 20)}%`;
        face.style.bottom = `${12 + (i % 2) * 18}%`;
        face.style.setProperty("--dx", `${(i % 2 === 0 ? -1 : 1) * (18 + i * 6)}px`);
        reaction.appendChild(face);
    }
}

export function showChallenge(
    challenge,
    onSolved,
    type = "timed"
) {
    if (!challenge || !Array.isArray(challenge.options)) return;

    currentChallengeType = type;

    els.challengeTitle.textContent = challenge.title || "Reto educativo";
    els.challengeQuestion.textContent = challenge.question || "Selecciona una respuesta.";
    els.challengeFeedback.textContent = "";
    els.challengeFeedback.className = "";
    els.challengeInfo.textContent = "";
    els.challengeInfo.hidden = true;
    els.btnChallengeContinue.hidden = true;
    els.challengeOptions.innerHTML = "";
    els.challengePanel?.classList.remove("is-correct", "is-incorrect");
    if (els.challengeReaction) {
        els.challengeReaction.innerHTML = "";
        els.challengeReaction.classList.remove("is-correct", "is-incorrect");
    }

    challenge.options.forEach((option, index) => {
        const button = document.createElement("button");

        button.type = "button";
        button.className = "shop-item";
        button.textContent = option;

        button.addEventListener("click", () => {
            if (!els.btnChallengeContinue.hidden) return;

            if (index === challenge.correct) {
                const message = "¡Excelente! ¡Respuesta correcta!";
                els.challengeFeedback.textContent = message;
                els.challengeFeedback.className = "is-success";
                els.challengeInfo.textContent = challenge.info || "";
                els.challengeInfo.hidden = false;
                els.btnChallengeContinue.hidden = true;
                els.challengePanel?.classList.remove("is-incorrect");
                els.challengePanel?.classList.add("is-correct");
                spawnChallengeMood("correct");

                els.challengeOptions.querySelectorAll("button").forEach((btn) => {
                    btn.disabled = true;
                });

                if (typeof onSolved === "function") {
                    onSolved(challenge);
                }
            } else {
                const message = "¡Ups! Esa no es la respuesta. ¡Inténtalo de nuevo!";
                els.challengeFeedback.textContent = message;
                els.challengeFeedback.className = "is-error";
                els.challengePanel?.classList.remove("is-correct");
                els.challengePanel?.classList.add("is-incorrect");
                spawnChallengeMood("wrong");
                button.classList.add("is-incorrect");
            }
        });

        els.challengeOptions.appendChild(button);
    });

    showScreen("screenChallenge");
}
