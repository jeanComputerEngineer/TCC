import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';   // Para *ngFor, *ngIf
import { FormsModule } from '@angular/forms';       // Para [(ngModel)]
import { ApiService, Horario, Turma, Professor, Materia } from '../../services/api.service';

@Component({
  selector: 'app-resultados',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './resultados.component.html',
  styleUrls: ['./resultados.component.css']
})
export class ResultadosComponent implements OnInit {
  turmas: Turma[] = [];
  professores: Professor[] = [];
  materias: Materia[] = [];

  // Seleção para cada tipo
  selectedTurma: Turma | null = null;
  selectedProfessor: Professor | null = null;

  // Mensagens de erro para validação
  turmaError: string = '';
  professorError: string = '';

  // Horários e grid para Turma
  horariosTurma: Horario[] = [];
  timeSlotsTurma: string[] = [];
  gridTurma: { [time: string]: { [day: string]: Horario | null } } = {};

  // Horários e grid para Professor
  horariosProfessor: Horario[] = [];
  timeSlotsProfessor: string[] = [];
  gridProfessor: { [time: string]: { [day: string]: Horario | null } } = {};

  // Dias da semana
  days: string[] = ['Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta'];

  constructor(private api: ApiService) { }

  ngOnInit(): void {
    this.loadTurmas();
    this.loadProfessores();
    this.loadMaterias();
  }

  loadTurmas(): void {
    this.api.getTurmas().subscribe((data: Turma[]) => {
      this.turmas = data;
    });
  }

  loadProfessores(): void {
    this.api.getProfessores().subscribe((data: Professor[]) => {
      this.professores = data;
    });
  }

  loadMaterias(): void {
    this.api.getMaterias().subscribe((data: Materia[]) => {
      this.materias = data;
    });
  }

  loadHorariosByTurma(): void {
    this.turmaError = '';
    if (!this.selectedTurma || !this.selectedTurma.id) {
      this.turmaError = 'Por favor, selecione uma turma.';
      return;
    }
    this.api.getHorariosByTurma(this.selectedTurma.id).subscribe((data: Horario[]) => {
      this.horariosTurma = data;
      this.buildGridTurma();
    });
  }

  loadHorariosByProfessor(): void {
    this.professorError = '';
    if (!this.selectedProfessor || !this.selectedProfessor.id) {
      this.professorError = 'Por favor, selecione um professor.';
      return;
    }
    this.api.getHorariosByProfessor(this.selectedProfessor.id).subscribe((data: Horario[]) => {
      this.horariosProfessor = data;
      this.buildGridProfessor();
    });
  }

  buildGridTurma(): void {
    const timeSet = new Set<string>();
    this.horariosTurma.forEach(h => {
      if (h.horarioInicio) {
        const formatted = h.horarioInicio.length > 5 ? h.horarioInicio.slice(0, 5) : h.horarioInicio;
        timeSet.add(formatted);
      }
    });
    this.timeSlotsTurma = Array.from(timeSet).sort((a, b) => this.timeToMinutes(a) - this.timeToMinutes(b));
    this.gridTurma = {};
    this.timeSlotsTurma.forEach(time => {
      this.gridTurma[time] = {};
      this.days.forEach(day => {
        const found = this.horariosTurma.find(h => {
          if (!h.horarioInicio) return false;
          const t = h.horarioInicio.length > 5 ? h.horarioInicio.slice(0, 5) : h.horarioInicio;
          return t === time && h.diaSemana === day;
        });
        this.gridTurma[time][day] = found || null;
      });
    });
  }

  buildGridProfessor(): void {
    const timeSet = new Set<string>();
    this.horariosProfessor.forEach(h => {
      if (h.horarioInicio) {
        const formatted = h.horarioInicio.length > 5 ? h.horarioInicio.slice(0, 5) : h.horarioInicio;
        timeSet.add(formatted);
      }
    });
    this.timeSlotsProfessor = Array.from(timeSet).sort((a, b) => this.timeToMinutes(a) - this.timeToMinutes(b));
    this.gridProfessor = {};
    this.timeSlotsProfessor.forEach(time => {
      this.gridProfessor[time] = {};
      this.days.forEach(day => {
        const found = this.horariosProfessor.find(h => {
          if (!h.horarioInicio) return false;
          const t = h.horarioInicio.length > 5 ? h.horarioInicio.slice(0, 5) : h.horarioInicio;
          return t === time && h.diaSemana === day;
        });
        this.gridProfessor[time][day] = found || null;
      });
    });
  }

  // Converte "HH:MM" em minutos para ordenação
  timeToMinutes(time: string): number {
    const [h, m] = time.split(':').map(Number);
    return h * 60 + m;
  }

  // Retorna o nome do professor a partir do ID
  getProfessorName(profId: number | undefined): string {
    if (profId === undefined) return '';
    const prof = this.professores.find(p => p.id === profId);
    return prof ? prof.nomeProfessor : 'Professor Desconhecido';
  }

  // Retorna o nome da matéria a partir do ID
  getMateriaName(matId: number | undefined): string {
    if (matId === undefined) return '';
    const mat = this.materias.find(m => m.id === matId);
    return mat ? mat.nomeMateria : 'Matéria Desconhecida';
  }

  // Gera os horários automaticamente
  generateHorarios(): void {
    if (confirm('Gerar horários automaticamente?')) {
      this.api.generateHorarios().subscribe(() => {
        alert('Horários gerados com sucesso!');
        // Recarrega os horários se houver seleção
        if (this.selectedTurma) {
          this.loadHorariosByTurma();
        }
        if (this.selectedProfessor) {
          this.loadHorariosByProfessor();
        }
      });
    }
  }
}
