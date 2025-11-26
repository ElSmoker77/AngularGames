
// ===============================
// DUELO ONLINE
// ===============================

export type ActionType = 'attack' | 'reload' | 'block' | 'afk';

export interface DuelConfig {
  startingAmmo: number;
  maxAmmo: number;
  maxConsecutiveBlocks: number;
  afkLimit: number;
  preciseShotChance: number;
  maxTurtleTurnsWithoutAttack: number;
  hpPerPlayer: number;
  turnDurationMs: number;
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
}

// Estado compartido para LOCAL y ONLINE.
// - LOCAL usa: currentTurn
// - ONLINE usa: gameStarted, pendingActions, turnEndsAt, config
export interface DuelState {
  players: DuelPlayer[];

  //  LOCAL (duel-local, duel.services)
  currentTurn: number;        // índice del jugador actual: 0 o 1

  //  Ambos modos
  isRoundOver: boolean;
  winnerId: number | null;
  round: number;
  log: string[];

  //  ONLINE (servidor Node)
  gameStarted?: boolean;
  pendingActions?: {
    [playerId: number]: ActionType | null;
  };
  turnEndsAt?: number | null;

  //  Config de modo (server)
  config?: DuelConfig;
}
