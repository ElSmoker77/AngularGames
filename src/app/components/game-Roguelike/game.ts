import { Component, HostListener } from '@angular/core';
import { GameService } from '../../core/game.services';
import { GameState, Tile } from '../../core/models/game-models';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-game',
  templateUrl: './game.html',
  styleUrls: ['./game.scss'],
  imports:[CommonModule],
})
export class GameComponent {

  constructor(public game: GameService) {}

  get state(): GameState {
    return this.game.state;
  }

  @HostListener('window:keydown', ['$event'])
  handleKey(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowUp':
      case 'w':
        this.game.movePlayer(0, -1);
        break;
      case 'ArrowDown':
      case 's':
        this.game.movePlayer(0, 1);
        break;
      case 'ArrowLeft':
      case 'a':
        this.game.movePlayer(-1, 0);
        break;
      case 'ArrowRight':
      case 'd':
        this.game.movePlayer(1, 0);
        break;
      case 'r':
        this.game.newGame();
        break;
    }
  }

  trackRow(index: number, row: Tile[]): number {
    return index;
  }

  trackTile(index: number, tile: Tile): number {
    return tile.x;
  }
}
