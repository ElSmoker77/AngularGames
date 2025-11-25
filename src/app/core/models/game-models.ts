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

