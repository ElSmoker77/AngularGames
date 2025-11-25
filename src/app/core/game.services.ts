// src/app/core/game.service.ts

import { Injectable } from '@angular/core';
import { Enemy, GameState, Player, Tile, TileType, Item } from './models/game-models';

@Injectable({
  providedIn: 'root'
})
export class GameService {

  state!: GameState;
  width = 20;
  height = 12;

  private enemyId = 1;
  private itemId = 1;

  constructor() {
    this.newGame();
  }

  newGame() {
    const map = this.generateMap();
    const player: Player = {
      id: 0,
      name: 'Hero',
      hp: 20,
      maxHp: 20,
      attack: 4,
      position: { x: 1, y: 1 },
      xp: 0,
      level: 1
    };

    const enemies = this.spawnEnemies(map, 5);
    const items = this.spawnItems(map, 2);

    this.state = {
      map,
      player,
      enemies,
      items,                             // 👈 ahora sí se guardan los items
      isGameOver: false,
      isWin: false,
      log: ['¡La aventura comienza!']
    };

    this.updateMap();
  }

  // Generar mapa
  private generateMap(): Tile[][] {
    const map: Tile[][] = [];
    for (let y = 0; y < this.height; y++) {
      const row: Tile[] = [];
      for (let x = 0; x < this.width; x++) {
        const isBorder = (x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1);
        const type: TileType = isBorder ? 'wall' : 'floor';
        row.push({ x, y, type });
      }
      map.push(row);
    }

    // salida del nivel
    map[this.height - 2][this.width - 2].type = 'exit';

    return map;
  }

  // Spawn de enemigos aleatorio
  private spawnEnemies(map: Tile[][], count: number): Enemy[] {
    const enemies: Enemy[] = [];
    for (let i = 0; i < count; i++) {
      let x, y;
      do {
        x = 2 + Math.floor(Math.random() * (this.width - 4));
        y = 2 + Math.floor(Math.random() * (this.height - 4));
      } while (x === 1 && y === 1); // evitar spawn sobre el jugador

      enemies.push({
        id: this.enemyId++,
        name: 'Goblin',
        hp: 8,
        maxHp: 8,
        attack: 2,
        position: { x, y },
        aggressive: true
      });
    }
    return enemies;
  }

  // Spawn de items (pociones)
  private spawnItems(map: Tile[][], count: number): Item[] {
    const items: Item[] = [];

    for (let i = 0; i < count; i++) {
      let x, y;
      do {
        x = 2 + Math.floor(Math.random() * (this.width - 4));
        y = 2 + Math.floor(Math.random() * (this.height - 4));
      } while (
        (x === 1 && y === 1) || // no sobre el player
        map[y][x].type === 'wall'
      );

      items.push({
        id: this.itemId++,
        name: 'Poción pequeña',
        position: { x, y },
        type: 'potion'
      });
    }

    return items;
  }

  /** Actualiza el mapa con player, enemigos e items */
  private updateMap() {
    for (const row of this.state.map) {
      for (const tile of row) {
        if (tile.type !== 'wall' && tile.type !== 'exit') {
          tile.type = 'floor';
        }
      }
    }

    // player
    const p = this.state.player.position;
    this.state.map[p.y][p.x].type = 'player';

    // enemigos
    for (const e of this.state.enemies) {
      const pos = e.position;
      this.state.map[pos.y][pos.x].type = 'enemy';
    }

    // items
    for (const item of this.state.items) {
      const pos = item.position;
      // solo si no está el player o un enemigo encima
      if (this.state.player.position.x === pos.x && this.state.player.position.y === pos.y) continue;
      if (this.state.enemies.some(e => e.position.x === pos.x && e.position.y === pos.y)) continue;

      this.state.map[pos.y][pos.x].type = 'item';
    }

    // mantener la salida
    const exitX = this.width - 2;
    const exitY = this.height - 2;
    this.state.map[exitY][exitX].type = 'exit';
  }

  /** Movimiento del jugador */
  movePlayer(dx: number, dy: number) {
    if (this.state.isGameOver || this.state.isWin) return;

    const newX = this.state.player.position.x + dx;
    const newY = this.state.player.position.y + dy;

    const tile = this.state.map[newY]?.[newX];
    if (!tile || tile.type === 'wall') return;

    const enemy = this.state.enemies.find(e => e.position.x === newX && e.position.y === newY);

    if (enemy) {
      this.attackEnemy(enemy);
    } else if (tile.type === 'exit') {
      this.state.isWin = true;
      this.state.log.unshift('¡Has encontrado la salida!');
    } else {
      this.state.player.position = { x: newX, y: newY };

      // revisar si hay item en la nueva posición
      const item = this.state.items.find(it => it.position.x === newX && it.position.y === newY);
      if (item) {
        this.pickItem(item);
      }
    }

    // turno de los enemigos
    this.moveEnemies();

    this.updateMap();
  }

  // Ataques del jugador al enemigo
  private attackEnemy(enemy: Enemy) {
    enemy.hp -= this.state.player.attack;
    this.state.log.unshift(`Golpeas al ${enemy.name} por ${this.state.player.attack} de daño.`);

    if (enemy.hp <= 0) {
      this.state.log.unshift(`${enemy.name} ha muerto.`);
      this.state.enemies = this.state.enemies.filter(e => e.id !== enemy.id);
      this.state.player.xp += 5;

      this.checkLevelUp();
    }
  }

  // Subir nivel de jugador
  private checkLevelUp() {
    const p = this.state.player;
    const xpNeeded = p.level * 10; // lvl 1 → 10xp, lvl 2 → 20xp...

    if (p.xp >= xpNeeded) {
      p.level++;
      p.xp = 0; // o p.xp -= xpNeeded si quieres acumular
      p.maxHp += 5;
      p.hp = p.maxHp; // curamos al subir de nivel
      p.attack += 1;
      this.state.log.unshift(`¡Subes a nivel ${p.level}! Ahora eres más fuerte.`);
    }
  }

  // Recoger item (poción)
  private pickItem(item: Item) {
    this.state.items = this.state.items.filter(it => it.id !== item.id);
    const heal = 5;
    this.state.player.hp = Math.min(this.state.player.maxHp, this.state.player.hp + heal);
    this.state.log.unshift(`Encuentras ${item.name}. Recuperas ${heal} HP.`);
  }

  // Movimiento de enemigos
  private moveEnemies() {
    for (const enemy of this.state.enemies) {
      const dx = this.state.player.position.x - enemy.position.x;
      const dy = this.state.player.position.y - enemy.position.y;

      let stepX = 0;
      let stepY = 0;

      if (Math.abs(dx) + Math.abs(dy) <= 6) {
        // acercarse al jugador
        stepX = dx === 0 ? 0 : dx / Math.abs(dx);
        stepY = dy === 0 ? 0 : dy / Math.abs(dy);
      } else {
        // movimiento random
        const dir = Math.floor(Math.random() * 4);
        if (dir === 0) stepX = 1;
        if (dir === 1) stepX = -1;
        if (dir === 2) stepY = 1;
        if (dir === 3) stepY = -1;
      }

      this.tryMoveEnemy(enemy, stepX, stepY);
    }
  }

  private tryMoveEnemy(enemy: Enemy, dx: number, dy: number) {
    const nx = enemy.position.x + dx;
    const ny = enemy.position.y + dy;
    const tile = this.state.map[ny]?.[nx];

    if (!tile || tile.type === 'wall' || tile.type === 'exit') return;

    // Si se mueve encima del jugador: ataque
    if (this.state.player.position.x === nx && this.state.player.position.y === ny) {
      this.state.player.hp -= enemy.attack;
      this.state.log.unshift(`${enemy.name} te ataca por ${enemy.attack} de daño.`);

      if (this.state.player.hp <= 0) {
        this.state.isGameOver = true;
        this.state.log.unshift('Has muerto...');
      }
      return;
    }

    // si no está el jugador, se mueve normal
    enemy.position = { x: nx, y: ny };
  }

}
