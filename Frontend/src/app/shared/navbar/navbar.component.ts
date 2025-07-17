// src/app/shared/navbar/navbar.component.ts
import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterModule } from '@angular/router';

@Component({
  selector: 'app-navbar',
  standalone: true,
  imports: [CommonModule, RouterModule],
  templateUrl: './navbar.component.html',
  styleUrls: ['./navbar.component.css']
})
export class NavbarComponent {
  menuAtivo: boolean = false;
  temaEscuro: boolean = false;

  toggleMenu(): void {
    this.menuAtivo = !this.menuAtivo;
  }

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
