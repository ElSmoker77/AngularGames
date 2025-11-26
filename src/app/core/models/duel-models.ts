// ===============================
// ROGUELIKE (sin cambios)
// ===============================

export type TileType = 'wall' | 'floor' | 'player' | 'enemy' | 'exit' | 'item';

export interface Position {
  x: number;
  y: number;
}

export interface Tile {
  x: number;
  y: number;
  type: TileType;
}

export interface Entity {
  id: number;
  name: string;
  hp: number;
  maxHp: number;
  attack: number;
  position: Position;
}

export interface Player extends Entity {
  xp: number;
  level: number;
}

export interface Enemy extends Entity {
  aggressive: boolean;
}

export interface Item {
  id: number;
  name: string;
  position: Position;
  type: 'potion';
}

export interface GameState {
  map: Tile[][];
  player: Player;
  enemies: Enemy[];
  isGameOver: boolean;
  isWin: boolean;
  log: string[];
  items: Item[];
}

// ===============================
// DUELO ONLINE
// ===============================

export type ActionType = 'attack' | 'reload' | 'block' | 'afk';

export type DuelMode = 'normal' | 'tactico' | 'custom';

export interface DuelConfig {
  startingAmmo: number;
  maxAmmo: number;
  maxConsecutiveBlocks: number;
  afkLimit: number;
  preciseShotChance: number;
  maxTurtleTurnsWithoutAttack: number;
  hpPerPlayer: number;
  turnDurationMs: number;

  // Probabilidades especiales (modo táctico y custom con probabilidades)
  turtleDropChance?: number;        // chance de soltar bala por dudar
  perfectBlockChance?: number;      // bloqueo perfecto (parry)
  jamChance?: number;               // arma encasquillada
  doubleReloadChance?: number;      // recarga doble
  reloadDropChance?: number;        // al recargar, chance extra de tirar bala
  lastStandChance?: number;         // última oportunidad (quedarse en 1 de vida)
  miracleDodgeChance?: number;      // esquive milagroso
  ghostBulletChance?: number;       // bala fantasma (no se consume)
  nervousShotMissChance?: number;   // balas nerviosas (disparo falla por confiado)
  shieldWeakenChance?: number;      // tiro de advertencia, debilita escudo

  // Mirada intimidante (multiplica eventos negativos sobre el que va atrás)
  intimidationHpDiff?: number;      // diferencia de HP para considerarlo "en desventaja"
  intimidationAmmoDiff?: number;    // diferencia de balas
  intimidationMultiplier?: number;  // multiplicador de probabilidades negativas
}

export interface DuelPlayer {
  id: number;
  name: string;
  hp: number;
  maxHp: number;
  ammo: number;
  isBlocking: boolean;
  lastAction: ActionType | null;
  score: number;

  // Tracking extra (online)
  consecutiveBlocks?: number;
  consecutiveHits?: number;
  turnsWithoutAttack?: number;
  afkTurns?: number;

  // Escudo debilitado por "tiro de advertencia"
  shieldWeakened?: boolean;

  // Para que "última oportunidad" no se dispare infinitas veces
  lastStandUsed?: boolean;
}

// Estado compartido para LOCAL y ONLINE.
// - LOCAL usa: currentTurn
// - ONLINE usa: gameStarted, pendingActions, turnEndsAt, config, mode
export interface DuelState {
  players: DuelPlayer[];

  // 👇 LOCAL (duel-local, duel.services)
  currentTurn: number;        // índice del jugador actual: 0 o 1

  // 👇 Ambos modos
  isRoundOver: boolean;
  winnerId: number | null;
  round: number;
  log: string[];

  // 👇 ONLINE (servidor Node)
  gameStarted?: boolean;
  pendingActions?: {
    [playerId: number]: ActionType | null;
  };
  turnEndsAt?: number | null;

  // 👇 Config de modo (server)
  config?: DuelConfig;
  mode?: DuelMode;
}
