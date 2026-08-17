import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'app-selection-step',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './selection-step.component.html',
  styleUrls: ['./selection-step.component.css'],
})
export class SelectionStepComponent {
  @Input() selectionFiles: File[] = [];
  @Input() hasSelectionFiles = false;
  @Input() busy = false;

  @Output() readonly selectionFilesChange = new EventEmitter<Event>();
  @Output() readonly removeSelectionFile = new EventEmitter<number>();
  @Output() readonly clearSelectionFiles = new EventEmitter<void>();
  @Output() readonly openPreviewStep = new EventEmitter<void>();

  onRemove(index: number): void {
    this.removeSelectionFile.emit(index);
  }

  onClear(): void {
    this.clearSelectionFiles.emit();
  }

  onOpenPreviewStep(): void {
    this.openPreviewStep.emit();
  }

  trackByFile(index: number, file: File): string {
    return `${index}-${file.name}-${file.size}-${file.lastModified}`;
  }
}
