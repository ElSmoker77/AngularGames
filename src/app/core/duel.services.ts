// src/app/core/duel.service.ts

import { Injectable } from '@angular/core';
import { ActionType, DuelPlayer, DuelState } from './models/duel-models';

@Injectable({
  providedIn: 'root'
})
export class DuelService {

  state!: DuelState;

  constructor() {
    this.newGame();
  }

  newGame() {
    const player1: DuelPlayer = {
      id: 1,
      name: 'Jugador 1',
      hp: 3,
      maxHp: 3,
      ammo: 0,                 // 👈 arranca sin balas
      isBlocking: false,
      lastAction: null,
      score: 0
    };

    const player2: DuelPlayer = {
      id: 2,
      name: 'Jugador 2',
      hp: 3,
      maxHp: 3,
      ammo: 0,                 // 👈 arranca sin balas
      isBlocking: false,
      lastAction: null,
      score: 0
    };

    const firstTurn = Math.random() < 0.5 ? 0 : 1;

    this.state = {
      players: [player1, player2],
      currentTurn: firstTurn as 0 | 1,
      isRoundOver: false,
      winnerId: null,
      round: 1,
      log: [
        `Se lanza la moneda... Comienza ${firstTurn === 0 ? player1.name : player2.name}.`
      ]
    };
  }

  get currentPlayer(): DuelPlayer {
    return this.state.players[this.state.currentTurn];
  }

  get targetPlayer(): DuelPlayer {
    return this.state.players[this.state.currentTurn === 0 ? 1 : 0];
  }

  chooseAction(action: ActionType) {
    if (this.state.isRoundOver) return;

    const current = this.currentPlayer;
    const target = this.targetPlayer;

    // resetear bloqueo del turno anterior
    current.isBlocking = false;
    current.lastAction = action;

    switch (action) {
      case 'reload':
        this.handleReload(current);
        break;
      case 'block':
        this.handleBlock(current);
        break;
      case 'attack':
        this.handleAttack(current, target);
        break;
    }

    if (this.state.isRoundOver) {
      return;
    }

    this.nextTurn();
  }

  private handleReload(player: DuelPlayer) {
    player.ammo += 1;
    this.state.log.unshift(`${player.name} recarga. Munición: ${player.ammo}.`);
  }

  private handleBlock(player: DuelPlayer) {
    player.isBlocking = true;
    this.state.log.unshift(`${player.name} se pone en guardia (bloquear).`);
  }

  private handleAttack(attacker: DuelPlayer, defender: DuelPlayer) {
    if (attacker.ammo <= 0) {
      this.state.log.unshift(
        `${attacker.name} intenta atacar pero no tiene munición. ¡Debe recargar antes!`
      );
      return;
    }

    attacker.ammo -= 1;

    // bloquear = 0 daño
    if (defender.isBlocking) {
      this.state.log.unshift(
        `${defender.name} bloquea por completo el ataque de ${attacker.name}.`
      );
      return;
    }

    // cada ataque quita 1 vida
    defender.hp -= 1;
    this.state.log.unshift(
      `${attacker.name} acierta un disparo a ${defender.name}. Pierde 1 vida.`
    );

    if (defender.hp <= 0) {
      defender.hp = 0;
      this.handleRoundWin(attacker, defender);
    }
  }

  private handleRoundWin(winner: DuelPlayer, loser: DuelPlayer) {
    this.state.isRoundOver = true;
    this.state.winnerId = winner.id;
    winner.score += 1;

    const p1 = this.state.players[0];
    const p2 = this.state.players[1];

    this.state.log.unshift(
      `${winner.name} gana la ronda. Marcador: ${p1.name} ${p1.score} - ${p2.score} ${p2.name}.`
    );
  }

  nextRound() {
    if (!this.state.winnerId) return;

    const winnerIndex = this.state.players.findIndex(p => p.id === this.state.winnerId);
    const loserIndex = winnerIndex === 0 ? 1 : 0;

    this.state.round += 1;
    this.state.isRoundOver = false;
    this.state.winnerId = null;

    // El perdedor de la ronda anterior empieza la siguiente
    this.state.currentTurn = loserIndex as 0 | 1;

    // resetear vidas / munición / estado de ambos
    for (const player of this.state.players) {
      player.hp = player.maxHp;
      player.ammo = 0;              // 👈 siempre empiezan sin balas
      player.isBlocking = false;
      player.lastAction = null;
    }

    this.state.log.unshift(
      `--- Nueva ronda ${this.state.round}. Comienza ${this.state.players[loserIndex].name}. ---`
    );
  }

  private nextTurn() {
    this.state.currentTurn = this.state.currentTurn === 0 ? 1 : 0;
    const current = this.currentPlayer;
    this.state.log.unshift(`Turno de ${current.name}.`);
  }
}
