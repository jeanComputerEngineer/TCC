import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RootAnalysisResponse } from '../../../../services/root-analysis.service';
import { BatchEntry } from '../../root-analyzer.models';

@Component({
  selector: 'app-results-step',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './results-step.component.html',
  styleUrls: ['./results-step.component.css'],
})
export class ResultsStepComponent {
  @Input() analysis?: RootAnalysisResponse;
  @Input() isBatchProcessed = false;
  @Input() batchEntries: BatchEntry[] = [];
  @Input() activeBatchIndex = -1;

  @Output() readonly selectBatchEntry = new EventEmitter<number>();
  @Output() readonly downloadGrayscale = new EventEmitter<void>();
  @Output() readonly downloadSegmented = new EventEmitter<void>();
  @Output() readonly downloadSkeleton = new EventEmitter<void>();

  get hasValidAnalysis(): boolean {
    return this.analysis !== undefined;
  }

  get hasBatchNavigation(): boolean {
    return this.isBatchProcessed && this.batchEntries.length > 1;
  }

  get currentImageTitle(): string {
    if (!this.hasBatchNavigation || this.activeBatchIndex < 0 || this.activeBatchIndex >= this.batchEntries.length) {
      return '';
    }
    const entry = this.batchEntries[this.activeBatchIndex];
    return `Imagem atual ${this.activeBatchIndex + 1}/${this.batchEntries.length}: ${entry.file.name}`;
  }
}
