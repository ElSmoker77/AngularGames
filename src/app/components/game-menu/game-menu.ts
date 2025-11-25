import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { GameComponent } from '../game-Roguelike/game';
import { DuelOnlineComponent } from '../duel-online/duel-online';
import { DuelLocalComponent } from '../duel-local/duel-local';

type MenuView = 'none' | 'roguelike' | 'duel-local' | 'duel-online';

@Component({
  selector: 'app-game-menu',
  standalone: true,
  imports: [CommonModule, GameComponent, DuelLocalComponent, DuelOnlineComponent],
  templateUrl: './game-menu.html',
  styleUrls: ['./game-menu.scss']
})
export class GameMenuComponent {

  view: MenuView = 'none';

  open(view: MenuView) {
    this.view = view;
  }

  backToMenu() {
    this.view = 'none';
  }
}
