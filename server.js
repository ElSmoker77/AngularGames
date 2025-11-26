// =========================
// Server unificado para Render
// Sirve Angular (build) + Socket.IO
// =========================

const express = require('express');
const http = require('http');
const path = require('path');
const cors = require('cors');
const { Server } = require('socket.io');

// --- CONFIG ---
const TURN_DURATION_MS = 15_000; // por defecto

// 👇 Modo por defecto
const DEFAULT_MODE = 'tactico';

// =========================
// MODOS PREDEFINIDOS
// =========================

const MODES = {
  // Modo sencillo, sin probabilidades raras
  normal: {
    startingAmmo: 1,
    maxAmmo: 3,
    maxConsecutiveBlocks: 2,
    afkLimit: 3,
    preciseShotChance: 0,
    maxTurtleTurnsWithoutAttack: 0,
    hpPerPlayer: 3,
    turnDurationMs: TURN_DURATION_MS,
    turtleDropChance: 0
  },

  // Modo táctico: usa todas las probabilidades raras
  tactico: {
    startingAmmo: 1,
    maxAmmo: 3,
    maxConsecutiveBlocks: 2,
    afkLimit: 3,
    preciseShotChance: 0.08,            // 8% disparo preciso base
    maxTurtleTurnsWithoutAttack: 3,
    hpPerPlayer: 3,
    turnDurationMs: TURN_DURATION_MS,
    turtleDropChance: 0.2,              // 20% al cumplir tortuga

    // especiales (todas bajas)
    perfectBlockChance: 0.07,           // bloqueo perfecto
    jamChance: 0.06,                    // arma encasquillada
    doubleReloadChance: 0.08,           // recarga doble
    reloadDropChance: 0.03,             // al recargar, chance de tirar bala
    lastStandChance: 0.05,              // última oportunidad
    miracleDodgeChance: 0.03,           // esquive milagroso
    ghostBulletChance: 0.02,            // bala fantasma
    nervousShotMissChance: 0.05,        // balas nerviosas
    shieldWeakenChance: 0.05,           // tiro de advertencia

    // mirada intimidante
    intimidationHpDiff: 2,
    intimidationAmmoDiff: 2,
    intimidationMultiplier: 1.5
  }
};

const app = express();
app.use(cors());

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// --- SERVIR ANGULAR COMPILADO ---
const distPath = path.join(__dirname, 'dist', 'angular-roguelike', 'browser');
app.use(express.static(distPath));

// SPA fallback (todas las rutas -> index.html)
app.use((req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// =========================
//   SISTEMA DE SALAS
// =========================

const rooms = {};   // roomId -> { state, playersSockets, turnTimer }
const clients = {}; // socketId -> { roomId, playerId }

function generateRoomId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  for (let i = 0; i < 6; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function createInitialPlayer(id, name, config) {
  const cfg = config || MODES[DEFAULT_MODE];
  return {
    id,
    name,
    hp: cfg.hpPerPlayer,
    maxHp: cfg.hpPerPlayer,
    ammo: cfg.startingAmmo,
    isBlocking: false,
    lastAction: null,
    score: 0,
    consecutiveBlocks: 0,
    consecutiveHits: 0,
    turnsWithoutAttack: 0,
    afkTurns: 0,
    shieldWeakened: false,
    lastStandUsed: false
  };
}

function pushLog(state, msg) {
  state.log.unshift(msg);
  if (state.log.length > 50) state.log.pop();
}

function ensurePlayerTrackingFields(player) {
  if (typeof player.consecutiveBlocks !== 'number') player.consecutiveBlocks = 0;
  if (typeof player.consecutiveHits !== 'number') player.consecutiveHits = 0;
  if (typeof player.turnsWithoutAttack !== 'number') player.turnsWithoutAttack = 0;
  if (typeof player.afkTurns !== 'number') player.afkTurns = 0;
  if (typeof player.shieldWeakened !== 'boolean') player.shieldWeakened = false;
  if (typeof player.lastStandUsed !== 'boolean') player.lastStandUsed = false;
}

function getCritChance(attacker, cfg) {
  const base = cfg.preciseShotChance || 0;
  if (base <= 0) return 0;  // modo sin críticos

  let chance = base;

  // Racha de aciertos → sube probabilidad
  if (attacker.consecutiveHits >= 2) {
    chance += 0.1; // +10% si viene en racha
  }

  if (chance > 0.5) chance = 0.5;
  return chance;
}

function isProbabilisticMode(cfg) {
  // activamos eventos locos sólo si tiene algo de preciseShotChance (>0)
  return (cfg.preciseShotChance || 0) > 0;
}

function getIntimidationFactor(player, other, cfg) {
  const hpDiff = cfg.intimidationHpDiff ?? 2;
  const ammoDiff = cfg.intimidationAmmoDiff ?? 2;
  const mult = cfg.intimidationMultiplier ?? 1.5;

  const behindHp = other.hp >= player.hp + hpDiff;
  const behindAmmo = other.ammo >= player.ammo + ammoDiff;

  if (behindHp || behindAmmo) {
    return mult;
  }
  return 1;
}

function startTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const state = room.state;
  if (!state.config) {
    state.config = MODES[state.mode] || MODES[DEFAULT_MODE];
  }
  const duration = state.config.turnDurationMs || TURN_DURATION_MS;

  state.pendingActions = { 1: null, 2: null };
  state.turnEndsAt = Date.now() + duration;

  if (room.turnTimer) clearTimeout(room.turnTimer);

  room.turnTimer = setTimeout(() => autoResolveTurn(roomId), duration);

  pushLog(state, `Nueva elección de acciones. Tienes ${duration / 1000} segundos.`);
}

function randomAction(player) {
  if (player.ammo <= 0) return Math.random() < 0.5 ? 'reload' : 'block';
  const r = Math.random();
  if (r < 0.34) return 'attack';
  if (r < 0.67) return 'reload';
  return 'block';
}

function autoResolveTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const state = room.state;
  room.turnTimer = null;

  if (!state.gameStarted || state.isRoundOver) return;

  const cfg = state.config || MODES[state.mode] || MODES[DEFAULT_MODE];

  const p1 = state.players[0];
  const p2 = state.players[1];

  ensurePlayerTrackingFields(p1);
  ensurePlayerTrackingFields(p2);

  if (!state.pendingActions[1]) {
    p1.afkTurns = (p1.afkTurns || 0) + 1;

    if (cfg.afkLimit && p1.afkTurns >= cfg.afkLimit) {
      state.pendingActions[1] = 'afk';
      pushLog(state, `${p1.name} se distrae mirando el horizonte y queda totalmente expuesto.`);
      p1.afkTurns = 0;
    } else {
      state.pendingActions[1] = randomAction(p1);
      pushLog(state, `${p1.name} no elige acción a tiempo. Se selecciona una acción automática.`);
    }
  } else {
    p1.afkTurns = 0;
  }

  if (!state.pendingActions[2]) {
    p2.afkTurns = (p2.afkTurns || 0) + 1;

    if (cfg.afkLimit && p2.afkTurns >= cfg.afkLimit) {
      state.pendingActions[2] = 'afk';
      pushLog(state, `${p2.name} se distrae mirando el horizonte y queda totalmente expuesto.`);
      p2.afkTurns = 0;
    } else {
      state.pendingActions[2] = randomAction(p2);
      pushLog(state, `${p2.name} no elige acción a tiempo. Se selecciona una acción automática.`);
    }
  } else {
    p2.afkTurns = 0;
  }

  pushLog(state, `Tiempo agotado. Se resuelven las acciones elegidas.`);

  resolveTurn(roomId);
}

// =========================
// RESOLVER TURNO COMPLETO
// =========================

function resolveTurn(roomId) {
  const room = rooms[roomId];
  if (!room) return;

  const state = room.state;
  const a1 = state.pendingActions[1];
  const a2 = state.pendingActions[2];

  if (!a1 || !a2) return;

  const p1 = state.players[0];
  const p2 = state.players[1];

  const cfg = state.config || MODES[state.mode] || MODES[DEFAULT_MODE];

  ensurePlayerTrackingFields(p1);
  ensurePlayerTrackingFields(p2);

  state.totalTurns = (state.totalTurns || 0) + 1;

  const probabilistic = isProbabilisticMode(cfg);

  const isAfk1 = (a1 === 'afk');
  const isAfk2 = (a2 === 'afk');

  // Flags: máximo 1 evento loco por jugador por turno
  let specialUsed1 = false;
  let specialUsed2 = false;

  // Mirada intimidante: factor para eventos negativos
  const intimidFactor1 = probabilistic ? getIntimidationFactor(p1, p2, cfg) : 1;
  const intimidFactor2 = probabilistic ? getIntimidationFactor(p2, p1, cfg) : 1;

  // Reset de bloqueo antes de aplicar acciones
  p1.isBlocking = false;
  p2.isBlocking = false;

  const preAmmo1 = p1.ammo;
  const preAmmo2 = p2.ammo;

  // --------------------
  // BLOQUEO (con límite + escudo debilitado)
  // --------------------
  if (!isAfk1 && a1 === 'block') {
    p1.consecutiveBlocks += 1;

    // Si escudo está debilitado, hay chance de que falle el bloqueo directamente
    let shieldFailed = false;
    if (probabilistic && p1.shieldWeakened && !specialUsed1) {
      const base = cfg.shieldWeakenChance || 0.05;
      const chance = base * intimidFactor1; // negativo
      if (Math.random() < chance) {
        shieldFailed = true;
        specialUsed1 = true;
        p1.shieldWeakened = false;
        pushLog(state, `${p1.name} intenta bloquear, pero su escudo cede en el último momento.`);
      }
    }

    if (shieldFailed) {
      p1.isBlocking = false;
      p1.consecutiveBlocks = cfg.maxConsecutiveBlocks || p1.consecutiveBlocks;
    } else if (p1.consecutiveBlocks > cfg.maxConsecutiveBlocks) {
      p1.isBlocking = false;
      p1.consecutiveBlocks = cfg.maxConsecutiveBlocks;
      pushLog(state, `${p1.name} se cansó de sostener el escudo y deja una abertura.`);
    } else {
      p1.isBlocking = true;
      if (p1.consecutiveBlocks === cfg.maxConsecutiveBlocks) {
        pushLog(state, `${p1.name} fuerza al máximo su escudo.`);
      } else {
        pushLog(state, `${p1.name} levanta el escudo.`);
      }
    }
  } else if (!isAfk1) {
    p1.consecutiveBlocks = 0;
  }

  if (!isAfk2 && a2 === 'block') {
    p2.consecutiveBlocks += 1;

    let shieldFailed = false;
    if (probabilistic && p2.shieldWeakened && !specialUsed2) {
      const base = cfg.shieldWeakenChance || 0.05;
      const chance = base * intimidFactor2;
      if (Math.random() < chance) {
        shieldFailed = true;
        specialUsed2 = true;
        p2.shieldWeakened = false;
        pushLog(state, `${p2.name} intenta bloquear, pero su escudo cede en el último momento.`);
      }
    }

    if (shieldFailed) {
      p2.isBlocking = false;
      p2.consecutiveBlocks = cfg.maxConsecutiveBlocks || p2.consecutiveBlocks;
    } else if (p2.consecutiveBlocks > cfg.maxConsecutiveBlocks) {
      p2.isBlocking = false;
      p2.consecutiveBlocks = cfg.maxConsecutiveBlocks;
      pushLog(state, `${p2.name} se cansó de sostener el escudo y deja una abertura.`);
    } else {
      p2.isBlocking = true;
      if (p2.consecutiveBlocks === cfg.maxConsecutiveBlocks) {
        pushLog(state, `${p2.name} fuerza al máximo su escudo.`);
      } else {
        pushLog(state, `${p2.name} levanta el escudo.`);
      }
    }
  } else if (!isAfk2) {
    p2.consecutiveBlocks = 0;
  }

  // --------------------
  // RECARGA (con tope + recarga doble / caída)
  // --------------------
  function handleReload(player, cfg, isAfk, intimidFactor, opponent, playerIndex) {
    if (isAfk) return;
    if (!cfg) return;

    const maxAmmo = cfg.maxAmmo;
    const probabilistic = isProbabilisticMode(cfg);
    let specialUsed = (playerIndex === 1) ? specialUsed1 : specialUsed2;

    if (player.ammo >= maxAmmo) {
      pushLog(state, `${player.name} intenta recargar, pero el cargador ya está lleno.`);
      if (playerIndex === 1) specialUsed1 = specialUsed;
      else specialUsed2 = specialUsed;
      return;
    }

    if (probabilistic && !specialUsed) {
      const baseDouble = cfg.doubleReloadChance || 0;
      const baseDrop = cfg.reloadDropChance || 0;

      const chanceDouble = baseDouble; // efecto positivo
      const chanceDrop = baseDrop * intimidFactor; // negativo (más si está intimidado)

      const r = Math.random();
      if (chanceDouble > 0 && r < chanceDouble) {
        const bulletsToAdd = Math.min(2, maxAmmo - player.ammo);
        player.ammo += bulletsToAdd;
        pushLog(state, `${player.name} hace una recarga relámpago y carga ${bulletsToAdd} balas.`);
        specialUsed = true;
      } else if (chanceDrop > 0 && r >= chanceDouble && r < chanceDouble + chanceDrop && player.ammo > 0) {
        // se le cae una bala
        player.ammo = Math.max(0, player.ammo - 1);
        pushLog(state, `${player.name} se apura demasiado y deja caer una bala del cargador.`);
        specialUsed = true;
      } else {
        // recarga normal
        player.ammo++;
        pushLog(state, `${player.name} recarga. Munición: ${player.ammo}/${maxAmmo}.`);
      }
    } else {
      // recarga normal
      player.ammo++;
      pushLog(state, `${player.name} recarga. Munición: ${player.ammo}/${maxAmmo}.`);
    }

    if (playerIndex === 1) specialUsed1 = specialUsed;
    else specialUsed2 = specialUsed;
  }

  handleReload(p1, cfg, isAfk1 || a1 !== 'reload', intimidFactor1, p2, 1);
  handleReload(p2, cfg, isAfk2 || a2 !== 'reload', intimidFactor2, p1, 2);

  // --------------------
  // ATAQUES + CRÍTICOS + eventos A-F
  // --------------------

  function resolveAttack({
    attacker,
    defender,
    action,
    isAfk,
    preAmmo,
    cfg,
    intimidFactor,
    attackerIndex,
    defenderIndex
  }) {
    const probabilistic = isProbabilisticMode(cfg);
    let specialUsedAtt = attackerIndex === 1 ? specialUsed1 : specialUsed2;
    let specialUsedDef = defenderIndex === 1 ? specialUsed1 : specialUsed2;

    if (isAfk || action !== 'attack') {
      attacker.turnsWithoutAttack++;
      if (attackerIndex === 1) {
        specialUsed1 = specialUsedAtt;
      } else {
        specialUsed2 = specialUsedAtt;
      }
      return;
    }

    attacker.turnsWithoutAttack = 0;

    if (preAmmo <= 0) {
      pushLog(state, `${attacker.name} intenta atacar pero no tiene munición.`);
      attacker.consecutiveHits = 0;
      if (attackerIndex === 1) specialUsed1 = specialUsedAtt;
      else specialUsed2 = specialUsedAtt;
      return;
    }

    // --- arma encasquillada (jam) ---
    if (probabilistic && !specialUsedAtt) {
      const baseJam = cfg.jamChance || 0;
      const jamChance = baseJam * intimidFactor; // negativo
      if (jamChance > 0 && Math.random() < jamChance) {
        pushLog(state, `El arma de ${attacker.name} se encasquilla en el peor momento.`);
        attacker.consecutiveHits = 0;
        specialUsedAtt = true;
        // no gastamos bala, no hay disparo
        if (attackerIndex === 1) specialUsed1 = specialUsedAtt;
        else specialUsed2 = specialUsedAtt;
        return;
      }
    }

    // consumimos bala
    attacker.ammo--;

    // --- balas nerviosas (shot miss aunque todo estaba bien) ---
    if (probabilistic && !specialUsedAtt) {
      const diffAmmo = attacker.ammo - defender.ammo;
      const diffHp = attacker.hp - defender.hp;
      const baseNervous = cfg.nervousShotMissChance || 0;

      if ((diffAmmo >= 2 || diffHp >= 2) && baseNervous > 0) {
        const nervousChance = baseNervous; // castigo a confiado
        if (Math.random() < nervousChance) {
          pushLog(state, `La confianza de ${attacker.name} le juega en contra y falla un disparo sencillo.`);
          attacker.consecutiveHits = 0;
          specialUsedAtt = true;
          if (attackerIndex === 1) specialUsed1 = specialUsedAtt;
          else specialUsed2 = specialUsedAtt;
          return;
        }
      }
    }

    // --- crítico (disparo preciso) ---
    const critChance = getCritChance(attacker, cfg);
    const isCrit = probabilistic && critChance > 0 && Math.random() < critChance;

    // --- aplicar impacto (teniendo en cuenta bloqueo perfecto, milagro, última oportunidad) ---
    let damage = 1;
    let hitBlocked = defender.isBlocking;
    let perfectBlock = false;

    // si el defensor bloquea, ver si hay bloqueo perfecto
    if (hitBlocked && probabilistic && !specialUsedDef) {
      const basePerfect = cfg.perfectBlockChance || 0;
      const perfectChance = basePerfect; // efecto positivo
      if (perfectChance > 0 && Math.random() < perfectChance) {
        perfectBlock = true;
        specialUsedDef = true;
      }
    }

    if (perfectBlock) {
      // devuelve el disparo al atacante
      pushLog(state, `${defender.name} realiza un bloqueo perfecto y devuelve el disparo a ${attacker.name}.`);

      // daño va al atacante, no al defensor
      applyDamageWithDefenses({
        victim: attacker,
        other: defender,
        damage,
        cfg,
        probabilistic,
        specialUsedVictim: attackerIndex === 1 ? specialUsed1 : specialUsed2,
        intimidFactorVictim: attackerIndex === 1 ? intimidFactor1 : intimidFactor2,
        attackerName: defender.name,
        victimIndex: attackerIndex
      });
    } else if (hitBlocked && !isCrit) {
      // bloqueo normal exitoso
      pushLog(state, `${defender.name} bloquea el disparo de ${attacker.name}.`);

      // tiro de advertencia: debilita escudo
      if (probabilistic && !specialUsedDef) {
        const baseWeaken = cfg.shieldWeakenChance || 0;
        if (baseWeaken > 0 && Math.random() < baseWeaken) {
          defender.shieldWeakened = true;
          specialUsedDef = true;
          pushLog(state, `El escudo de ${defender.name} queda temblando; el próximo bloqueo podría fallar.`);
        }
      }

      attacker.consecutiveHits = 0;
    } else {
      // golpe entra (crítico atraviesa escudo o no había bloqueo)
      if (hitBlocked && isCrit) {
        pushLog(
          state,
          `${attacker.name} realiza un disparo preciso que atraviesa el escudo de ${defender.name}. Pierde 1 vida.`
        );
      } else {
        pushLog(state, `${attacker.name} acierta un disparo a ${defender.name}. Pierde 1 vida.`);
      }

      applyDamageWithDefenses({
        victim: defender,
        other: attacker,
        damage,
        cfg,
        probabilistic,
        specialUsedVictim: defenderIndex === 1 ? specialUsed1 : specialUsed2,
        intimidFactorVictim: defenderIndex === 1 ? intimidFactor1 : intimidFactor2,
        attackerName: attacker.name,
        victimIndex: defenderIndex
      });

      attacker.consecutiveHits++;
    }

    // --- bala fantasma (no se consume) ---
    if (probabilistic && !specialUsedAtt) {
      const baseGhost = cfg.ghostBulletChance || 0;
      if (baseGhost > 0 && Math.random() < baseGhost) {
        attacker.ammo = Math.min(attacker.ammo + 1, cfg.maxAmmo);
        pushLog(state, `De forma casi mágica, ${attacker.name} recupera la bala tras el disparo.`);
        specialUsedAtt = true;
      }
    }

    // Actualizar flags de specialUsed
    if (attackerIndex === 1) specialUsed1 = specialUsedAtt;
    else specialUsed2 = specialUsedAtt;

    if (defenderIndex === 1) specialUsed1 = specialUsedDef || specialUsed1;
    else specialUsed2 = specialUsedDef || specialUsed2;
  }

  // Aplica daño a un jugador teniendo en cuenta:
  // A) última oportunidad (A)
  // B) esquive milagroso (B)
  function applyDamageWithDefenses({
    victim,
    other,
    damage,
    cfg,
    probabilistic,
    specialUsedVictim,
    intimidFactorVictim,
    attackerName,
    victimIndex
  }) {
    let used = specialUsedVictim;

    if (probabilistic && !used) {
      // B) Esquive milagroso: si aún tiene vida razonable y NO está bloqueando
      if (!victim.isBlocking && damage > 0) {
        const baseMiracle = cfg.miracleDodgeChance || 0;
        const chanceMiracle = baseMiracle; // positivo
        if (chanceMiracle > 0 && Math.random() < chanceMiracle) {
          pushLog(state, `Por puro reflejo, ${victim.name} se agacha y la bala pasa rozando.`);
          used = true;
          if (victimIndex === 1) specialUsed1 = used;
          else specialUsed2 = used;
          return;
        }
      }
    }

    // Si llega aquí, daño entra. Pero antes de matar, intentamos "última oportunidad"
    const willKill = victim.hp - damage <= 0;

    if (probabilistic && !used && willKill && !victim.lastStandUsed) {
      const baseLastStand = cfg.lastStandChance || 0;
      const chanceLastStand = baseLastStand; // positivo
      if (chanceLastStand > 0 && Math.random() < chanceLastStand) {
        victim.hp = 1;
        victim.lastStandUsed = true;
        pushLog(state, `${victim.name} se niega a caer y resiste el golpe con su última fuerza.`);
        used = true;
        if (victimIndex === 1) specialUsed1 = used;
        else specialUsed2 = used;
        return;
      }
    }

    // daño normal
    victim.hp -= damage;
    if (victim.hp < 0) victim.hp = 0;

    if (victimIndex === 1) specialUsed1 = used;
    else specialUsed2 = used;
  }

  // Resolver ataques de ambos jugadores
  resolveAttack({
    attacker: p1,
    defender: p2,
    action: a1,
    isAfk: isAfk1,
    preAmmo: preAmmo1,
    cfg,
    intimidFactor: intimidFactor1,
    attackerIndex: 1,
    defenderIndex: 2
  });

  resolveAttack({
    attacker: p2,
    defender: p1,
    action: a2,
    isAfk: isAfk2,
    preAmmo: preAmmo2,
    cfg,
    intimidFactor: intimidFactor2,
    attackerIndex: 2,
    defenderIndex: 1
  });

  // --------------------
  // Penalizar modo tortuga (si está activado en config)
  // --------------------
  const players = [p1, p2];
  for (const p of players) {
    const maxNoAtk = cfg.maxTurtleTurnsWithoutAttack || 0;
    const dropChanceBase = (typeof cfg.turtleDropChance === 'number') ? cfg.turtleDropChance : 1;
    if (maxNoAtk > 0 && p.turnsWithoutAttack >= maxNoAtk && p.ammo > 0) {
      // factor intimidación para eventos negativos
      const factor = (p === p1 ? intimidFactor1 : intimidFactor2);
      const dropChance = dropChanceBase * factor;
      if (dropChance > 0 && Math.random() < dropChance) {
        p.ammo--;
        pushLog(state, `${p.name} duda demasiado y deja caer una bala del cargador.`);
        p.turnsWithoutAttack = 0;
      } else {
        pushLog(state, `${p.name} duda, casi deja caer una bala...`);
      }
    }
  }

  // lastAction (no mostramos AFK como acción)
  p1.lastAction = (!isAfk1 && (a1 === 'attack' || a1 === 'reload' || a1 === 'block')) ? a1 : null;
  p2.lastAction = (!isAfk2 && (a2 === 'attack' || a2 === 'reload' || a2 === 'block')) ? a2 : null;

  const p1Dead = p1.hp <= 0;
  const p2Dead = p2.hp <= 0;

  if (p1Dead && p2Dead) {
    p1.hp = 0;
    p2.hp = 0;
    state.isRoundOver = true;
    state.winnerId = null;
    pushLog(state, `Ambos jugadores caen. Empate.`);
    io.to(roomId).emit('stateUpdate', state);
    return;
  }

  if (p1Dead) {
    p1.hp = 0;
    state.isRoundOver = true;
    state.winnerId = p2.id;
    p2.score++;
    pushLog(state, `${p2.name} gana la ronda.`);
    io.to(roomId).emit('stateUpdate', state);
    return;
  }

  if (p2Dead) {
    p2.hp = 0;
    state.isRoundOver = true;
    state.winnerId = p1.id;
    p1.score++;
    pushLog(state, `${p1.name} gana la ronda.`);
    io.to(roomId).emit('stateUpdate', state);
    return;
  }

  // Ambos vivos y sin balas → turno de tensión
  if (p1.ammo === 0 && p2.ammo === 0) {
    pushLog(state, `Ambos se quedan sin balas. El silencio inunda el campo de batalla.`);
  }

  // 👉 NADIE MUERE → mostramos resultado, animaciones,
  // sin timer, y luego de 2s comenzamos la nueva elección
  state.turnEndsAt = null;         // oculta barra de tiempo
  io.to(roomId).emit('stateUpdate', state); // muestra animaciones con lastAction

  setTimeout(() => {
    const r = rooms[roomId];
    if (!r) return;                // sala ya no existe
    const st = r.state;
    if (st.isRoundOver) return;    // por si algo raro pasó

    startTurn(roomId);
    io.to(roomId).emit('stateUpdate', st);
  }, 2000); // pausa de 2 segundos
}

// =========================
//  Socket.IO handlers
// =========================

io.on('connection', (socket) => {
  console.log('Nuevo cliente', socket.id);

  socket.on('createRoom', ({ playerName, mode, customConfig }) => {
    let roomId;
    do roomId = generateRoomId();
    while (rooms[roomId]);

    // --- elegir modo base ---
    const baseMode = (mode && MODES[mode]) ? mode : DEFAULT_MODE;
    let config = { ...MODES[baseMode] };

    // --- si el modo es custom, aplicamos overrides con límites ---
    if (mode === 'custom' && customConfig) {
      const clamp = (v, min, max) => Math.max(min, Math.min(max, v));

      if (typeof customConfig.hpPerPlayer === 'number') {
        config.hpPerPlayer = clamp(customConfig.hpPerPlayer, 1, 10);
      }

      if (typeof customConfig.maxAmmo === 'number') {
        config.maxAmmo = clamp(customConfig.maxAmmo, 1, 12);
      }

      if (typeof customConfig.preciseShotChance === 'number') {
        const p = customConfig.preciseShotChance;
        config.preciseShotChance = clamp(p, 0, 0.5); // 0% a 50%
      }

      if (typeof customConfig.maxTurtleTurnsWithoutAttack === 'number') {
        config.maxTurtleTurnsWithoutAttack = clamp(customConfig.maxTurtleTurnsWithoutAttack, 0, 10);
      }

      if (typeof customConfig.afkLimit === 'number') {
        config.afkLimit = clamp(customConfig.afkLimit, 1, 10);
      }

      // en modo custom, dejamos una caída de bala suave
      config.turtleDropChance = 0.3;
    }

    const p1 = createInitialPlayer(1, playerName || 'Jugador 1', config);
    const p2 = createInitialPlayer(2, 'Esperando...', config);

    rooms[roomId] = {
      state: {
        players: [p1, p2],
        currentTurn: 0,
        isRoundOver: false,
        winnerId: null,
        round: 1,
        log: [
          `Sala creada por ${p1.name}.`,
          `Esperando a que se conecte el segundo jugador...`
        ],
        gameStarted: false,
        pendingActions: { 1: null, 2: null },
        turnEndsAt: null,
        config,
        mode: mode === 'custom' ? 'custom' : baseMode,
        totalTurns: 0
      },
      playersSockets: { 1: socket.id, 2: null },
      turnTimer: null
    };

    clients[socket.id] = { roomId, playerId: 1 };
    socket.join(roomId);

    socket.emit('roomCreated', {
      roomId,
      playerId: 1,
      state: rooms[roomId].state
    });

    console.log(`Sala ${roomId} creada en modo ${rooms[roomId].state.mode}.`);
  });

  socket.on('joinRoom', ({ roomId, playerName }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit('errorMessage', 'Sala no encontrada.');
    if (room.playersSockets[2]) return socket.emit('errorMessage', 'La sala está llena.');

    const state = room.state;
    state.players[1].name = playerName || 'Jugador 2';
    room.playersSockets[2] = socket.id;
    clients[socket.id] = { roomId, playerId: 2 };
    socket.join(roomId);

    state.gameStarted = true;
    pushLog(state, `${state.players[1].name} se une a la sala. ¡Comienza el duelo!`);

    startTurn(roomId);

    socket.emit('roomJoined', { roomId, playerId: 2, state });
    io.to(roomId).emit('stateUpdate', state);

    console.log(`Jugador 2 se unió a la sala ${roomId}`);
  });

  socket.on('chooseAction', ({ roomId, action }) => {
    const info = clients[socket.id];
    if (!info || info.roomId !== roomId) return;

    const room = rooms[roomId];
    if (!room) return;

    const state = room.state;
    if (state.isRoundOver) return;

    const playerId = info.playerId;
    const player = state.players.find(p => p.id === playerId);
    if (!player) return;

    if (!state.pendingActions) state.pendingActions = { 1: null, 2: null };

    state.pendingActions[playerId] = action;
    pushLog(state, `${player.name} ha elegido su acción.`);

    if (state.pendingActions[1] && state.pendingActions[2]) {
      if (room.turnTimer) clearTimeout(room.turnTimer);
      resolveTurn(roomId);
    } else {
      io.to(roomId).emit('stateUpdate', state);
    }
  });

  socket.on('nextRound', ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    const state = room.state;
    if (!state.isRoundOver) return;

    const cfg = state.config || MODES[state.mode] || MODES[DEFAULT_MODE];

    state.round++;
    state.isRoundOver = false;
    state.winnerId = null;

    for (const p of state.players) {
      ensurePlayerTrackingFields(p);
      p.hp = cfg.hpPerPlayer;
      p.maxHp = cfg.hpPerPlayer;
      p.ammo = cfg.startingAmmo;
      p.isBlocking = false;
      p.lastAction = null;
      p.consecutiveBlocks = 0;
      p.consecutiveHits = 0;
      p.turnsWithoutAttack = 0;
      p.afkTurns = 0;
      p.shieldWeakened = false;
      p.lastStandUsed = false;
    }

    pushLog(state, `--- Nueva ronda ${state.round}. Comienza la elección de acciones. ---`);

    startTurn(roomId);
    io.to(roomId).emit('stateUpdate', state);
  });

  socket.on('disconnect', () => {
    const info = clients[socket.id];
    if (!info) return;

    const { roomId, playerId } = info;
    const room = rooms[roomId];
    if (room) {
      const state = room.state;
      const player = state.players.find(p => p.id === playerId);
      const other = state.players.find(p => p.id !== playerId);

      room.playersSockets[playerId] = null;

      if (player) pushLog(state, `${player.name} se ha desconectado.`);

      if (other && room.playersSockets[other.id]) {
        state.isRoundOver = true;
        state.winnerId = other.id;
        other.score++;
        pushLog(state, `${other.name} gana la ronda porque el oponente se desconectó.`);
      }

      io.to(roomId).emit('stateUpdate', state);

      if (!room.playersSockets[1] && !room.playersSockets[2]) {
        if (room.turnTimer) clearTimeout(room.turnTimer);
        delete rooms[roomId];
        console.log(`Sala ${roomId} eliminada (sin jugadores).`);
      }
    }

    delete clients[socket.id];
  });
});

// =========================
//  ARRANCAR SERVIDOR
// =========================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Servidor escuchando en puerto ${PORT}`);
});
