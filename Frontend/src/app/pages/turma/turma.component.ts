import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, NgForm } from '@angular/forms';
import { ApiService, Turma, Materia } from '../../services/api.service';

@Component({
  selector: 'app-turma',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './turma.component.html',
  styleUrls: ['./turma.component.css']
})
export class TurmaComponent implements OnInit {
  turmas: Turma[] = [];
  materias: Materia[] = [];

  showForm: boolean = false;
  editing: boolean = false;
  currentTurma: Turma = { nomeTurma: '' };

  // Mensagem de erro para o formulário
  formError: string = '';

  // Propriedades para o modal de atribuição de matéria
  showAssignMateriaModal: boolean = false;
  selectedTurmaForAssign: Turma | null = null;
  selectedMateriaId: number | null = null;
  assignmentQuantity: number = 1;

  // Valor máximo de aulas pré-cadastrado por período (exemplo)
  readonly MAX_AULAS_POR_TURMA: number = 5;

  constructor(private api: ApiService) { }

  ngOnInit(): void {
    this.loadTurmas();
    this.loadMaterias();
  }

  loadTurmas(): void {
    this.api.getTurmas().subscribe((data: Turma[]) => {
      console.log('Retorno da API:', data); // LOG para debug
      this.turmas = data;
    });
  }


  loadMaterias(): void {
    this.api.getMaterias().subscribe((data: Materia[]) => {
      this.materias = data;
    });
  }

  addTurma(): void {
    this.editing = false;
    this.currentTurma = { nomeTurma: '' };
    this.formError = '';
    this.showForm = true;
  }

  editTurma(turma: Turma): void {
    this.editing = true;
    this.currentTurma = { ...turma };
    this.formError = '';
    this.showForm = true;
  }

  deleteTurma(id: number | undefined): void {
    if (id === undefined) {
      console.error('ID inválido para exclusão.');
      return;
    }
    if (confirm('Deseja realmente excluir esta turma?')) {
      this.api.deleteTurma(id).subscribe(() => {
        this.loadTurmas();
      });
    }
  }

  // Modal para atribuição de matéria
  openAssignMateriaModal(turma: Turma): void {
    this.selectedTurmaForAssign = turma;
    this.selectedMateriaId = null;
    this.assignmentQuantity = 1;
    this.showAssignMateriaModal = true;
  }

  closeAssignMateriaModal(): void {
    this.showAssignMateriaModal = false;
    this.selectedTurmaForAssign = null;
    this.selectedMateriaId = null;
    this.assignmentQuantity = 1;
  }

  assignMateria(): void {
    if (!this.selectedTurmaForAssign || !this.selectedMateriaId) {
      alert('Selecione uma matéria.');
      return;
    }
    if (this.assignmentQuantity < 1 || this.assignmentQuantity > this.MAX_AULAS_POR_TURMA) {
      alert(`A quantidade de aulas deve ser entre 1 e ${this.MAX_AULAS_POR_TURMA}.`);
      return;
    }
    this.api.assignMateriaToTurma(
      this.selectedTurmaForAssign.id!,
      this.selectedMateriaId,
      this.assignmentQuantity
    ).subscribe(() => {
      this.loadTurmas();
      this.closeAssignMateriaModal();
    });
  }

  saveTurma(form: NgForm): void {
    if (!form.valid) {
      this.formError = 'O nome da turma deve ser preenchido corretamente.';
      return;
    }
    if (this.currentTurma.nomeTurma.length < 2 || this.currentTurma.nomeTurma.length > 30) {
      this.formError = 'O nome da turma deve ter entre 2 e 30 caracteres.';
      return;
    }
    this.formError = '';
    if (this.editing) {
      this.api.updateTurma(this.currentTurma).subscribe(() => {
        this.loadTurmas();
        this.showForm = false;
      });
    } else {
      this.api.addTurma(this.currentTurma).subscribe((res: Turma) => {
        this.loadTurmas();
        this.showForm = false;
        if (confirm('Deseja atribuir matérias agora?')) {
          this.openAssignMateriaModal(res);
        }
      });
    }
  }

  cancel(): void {
    this.showForm = false;
    this.formError = '';
  }


  getMateriaNames(turma: Turma): string {
    let materiasData = (turma as any).materias;
    let materiasArray: Materia[] = [];

    if (materiasData) {
      // Verifica se é um Buffer e converte para string se necessário
      if (materiasData instanceof Buffer) {
        materiasData = materiasData.toString('utf8');
      }
      if (typeof materiasData === 'string') {
        try {
          materiasArray = JSON.parse(materiasData);
        } catch (error) {
          console.error('Erro ao converter matérias (string):', error);
        }
      } else if (Array.isArray(materiasData)) {
        materiasArray = materiasData;
      } else if (typeof materiasData === 'object') {
        try {
          materiasArray = JSON.parse(JSON.stringify(materiasData));
        } catch (error) {
          console.error('Erro ao converter matérias (object):', error);
        }
      }
    }
    return materiasArray.length ? materiasArray.map((m: Materia) => m.nomeMateria).join(', ') : '-';
  }



}
