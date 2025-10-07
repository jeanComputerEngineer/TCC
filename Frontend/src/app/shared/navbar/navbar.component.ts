import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent {
  temaEscuro = false;

  toggleTema(): void {
    this.temaEscuro = !this.temaEscuro;
    const body = document.body;
    if (this.temaEscuro) {
      body.classList.add('theme-dark');
      body.classList.remove('theme-light');
    } else {
      body.classList.add('theme-light');
      body.classList.remove('theme-dark');
    }
  }
}
