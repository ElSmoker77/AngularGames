import { Component } from '@angular/core';
import { GameMenuComponent } from './components/game-menu/game-menu';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [GameMenuComponent],
  template: `<app-game-menu></app-game-menu>`
})
export class AppComponent {}
