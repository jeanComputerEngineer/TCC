import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ApiService, Periodo } from '../../services/api.service';

@Component({
  selector: 'app-periodo',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './periodo.component.html',
  styleUrls: ['./periodo.component.css']
})
export class PeriodoComponent implements OnInit {
  periodos: Periodo[] = [];
  showForm: boolean = false;
  editing: boolean = false;
  errorMessage: string = '';

  currentPeriodo: Periodo = {
    id: 0,
    horarioInicio: '',
    horarioFim: '',
    duracaoAula: 0,
    intervaloInicio: '',
    intervaloFim: ''
  };

  constructor(private api: ApiService) { }

  ngOnInit(): void {
    this.loadPeriodos();
  }

  loadPeriodos(): void {
    this.api.getPeriodos().subscribe((data: Periodo[]) => {
      this.periodos = data;
    });
  }

  addPeriodo(): void {
    if (this.periodos.length > 0) {
      this.errorMessage = 'Já existe um período cadastrado. Não é permitido cadastrar mais de um.';
      return;
    }
    this.editing = false;
    this.errorMessage = '';
    this.currentPeriodo = {
      id: 0,
      horarioInicio: '',
      horarioFim: '',
      duracaoAula: 0,
      intervaloInicio: '',
      intervaloFim: ''
    };
    this.showForm = true;
  }

  editPeriodo(periodo: Periodo): void {
    this.editing = true;
    this.errorMessage = '';
    this.currentPeriodo = { ...periodo };
    this.showForm = true;
  }

  deletePeriodo(id: number): void {
    if (confirm('Confirma a exclusão deste período?')) {
      this.api.deletePeriodo(id).subscribe(() => {
        this.loadPeriodos();
      });
    }
  }

  savePeriodo(): void {
    this.errorMessage = '';

    if (
      !this.currentPeriodo.horarioInicio ||
      !this.currentPeriodo.horarioFim ||
      !this.currentPeriodo.intervaloInicio ||
      !this.currentPeriodo.intervaloFim ||
      this.currentPeriodo.duracaoAula <= 0
    ) {
      this.errorMessage = 'Todos os campos são obrigatórios e a duração deve ser maior que zero.';
      return;
    }

    const timeRegex = /^([0-1]\d|2[0-3]):([0-5]\d)$/;
    if (
      !timeRegex.test(this.currentPeriodo.horarioInicio) ||
      !timeRegex.test(this.currentPeriodo.horarioFim) ||
      !timeRegex.test(this.currentPeriodo.intervaloInicio) ||
      !timeRegex.test(this.currentPeriodo.intervaloFim)
    ) {
      this.errorMessage = 'Por favor, informe os horários no formato HH:MM.';
      return;
    }

    const toMinutes = (time: string): number => {
      const [hours, minutes] = time.split(':').map(Number);
      return hours * 60 + minutes;
    };

    const inicio = toMinutes(this.currentPeriodo.horarioInicio);
    const fim = toMinutes(this.currentPeriodo.horarioFim);
    const intervaloInicio = toMinutes(this.currentPeriodo.intervaloInicio);
    const intervaloFim = toMinutes(this.currentPeriodo.intervaloFim);

    if (inicio >= fim) {
      this.errorMessage = 'O horário de início deve ser anterior ao horário de término.';
      return;
    }
    if (intervaloInicio >= intervaloFim) {
      this.errorMessage = 'O início do intervalo deve ser anterior ao fim do intervalo.';
      return;
    }
    if (intervaloInicio < inicio || intervaloFim > fim) {
      this.errorMessage = 'O intervalo deve estar dentro do período de aula.';
      return;
    }

    const totalPeriodMinutes = fim - inicio;
    const breakDuration = intervaloFim - intervaloInicio;
    const expectedTotal = this.currentPeriodo.duracaoAula + breakDuration;
    if (expectedTotal > totalPeriodMinutes) {
      this.errorMessage = 'O período informado não é compatível com a duração da aula e do intervalo.';
      return;
    }

    if (this.editing) {
      this.api.updatePeriodo(this.currentPeriodo).subscribe(() => {
        this.loadPeriodos();
        this.showForm = false;
      });
    } else {
      this.api.addPeriodo(this.currentPeriodo).subscribe(() => {
        this.loadPeriodos();
        this.showForm = false;
      });
    }
  }

  cancel(): void {
    this.errorMessage = '';
    this.showForm = false;
  }
}
