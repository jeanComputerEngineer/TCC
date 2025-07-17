import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';   // Para *ngFor, *ngIf, etc.
import { FormsModule } from '@angular/forms';       // Para [(ngModel)]
import { ApiService, Materia } from '../../services/api.service';

@Component({
  selector: 'app-materia',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './materia.component.html',
  styleUrls: ['./materia.component.css']
})
export class MateriaComponent implements OnInit {
  materias: Materia[] = [];
  showForm: boolean = false;
  editing: boolean = false;
  errorMessage: string = '';
  currentMateria: Materia = { nomeMateria: '' };

  constructor(private api: ApiService) { }

  ngOnInit(): void {
    this.loadMaterias();
  }

  // Carrega a lista de matérias
  loadMaterias(): void {
    this.api.getMaterias().subscribe((data: Materia[]) => {
      this.materias = data;
    });
  }

  // Prepara para adicionar uma nova matéria
  addMateria(): void {
    this.errorMessage = '';
    this.editing = false;
    this.currentMateria = { nomeMateria: '' };
    this.showForm = true;
  }

  // Prepara para editar uma matéria existente
  editMateria(materia: Materia): void {
    this.errorMessage = '';
    this.editing = true;
    this.currentMateria = { ...materia };
    this.showForm = true;
  }

  // Remove uma matéria após confirmação
  deleteMateria(id: number): void {
    if (confirm('Confirma a exclusão desta matéria?')) {
      this.api.deleteMateria(id).subscribe(() => {
        this.loadMaterias();
      });
    }
  }

  // Validação do nome da matéria: não permitir números e limite de 3 a 50 caracteres
  validateMateria(): boolean {
    const nome = this.currentMateria.nomeMateria.trim();
    const regex = /^[A-Za-zÀ-ÖØ-öø-ÿ\s]{3,50}$/;
    if (!nome) {
      this.errorMessage = 'O nome da matéria é obrigatório.';
      return false;
    }
    if (!regex.test(nome)) {
      this.errorMessage = 'O nome deve conter apenas letras e espaços (3 a 50 caracteres).';
      return false;
    }
    return true;
  }

  // Salva (adiciona ou atualiza) a matéria
  saveMateria(): void {
    if (!this.validateMateria()) {
      return;
    }

    if (this.editing) {
      this.api.updateMateria(this.currentMateria).subscribe(() => {
        this.loadMaterias();
        this.showForm = false;
      });
    } else {
      this.api.addMateria(this.currentMateria).subscribe(() => {
        this.loadMaterias();
        this.showForm = false;
      });
    }
  }

  // Cancela a operação e oculta o formulário/modal
  cancel(): void {
    this.showForm = false;
    this.errorMessage = '';
  }
}
