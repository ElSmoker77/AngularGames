import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { DuelService } from '../../core/duel.services';
import { DuelState, DuelPlayer } from '../../core/models/duel-models';

@Component({
  selector: 'app-duel-local',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './duel-local.html',
  styleUrls: ['./duel-local.scss']
})
export class DuelLocalComponent {

  maxAmmoDisplay = 3;

  constructor(public duel: DuelService) {}

  get state(): DuelState {
    return this.duel.state;
  }

  getPlayerClass(player: DuelPlayer): string {
    const current = this.state.players[this.state.currentTurn];
    return player.id === current.id ? 'player-card current' : 'player-card';
  }

  get winnerName(): string | null {
    if (!this.state.winnerId) return null;
    const w = this.state.players.find(p => p.id === this.state.winnerId);
    return w ? w.name : null;
  }

  getHearts(player: DuelPlayer): boolean[] {
    return Array.from({ length: player.maxHp }, (_, i) => i < player.hp);
  }

  getAmmoSlots(player: DuelPlayer): boolean[] {
    const filled = Math.min(player.ammo, this.maxAmmoDisplay);
    return Array.from({ length: this.maxAmmoDisplay }, (_, i) => i < filled);
  }

  doAction(action: 'attack' | 'reload' | 'block') {
    this.duel.chooseAction(action);
  }

  nextRound() {
    this.duel.nextRound();
  }
}
