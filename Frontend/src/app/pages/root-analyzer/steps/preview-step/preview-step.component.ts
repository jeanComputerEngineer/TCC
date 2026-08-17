import { CommonModule } from '@angular/common';
import { Component, ElementRef, EventEmitter, Input, Output, ViewChild } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { BackgroundOption, BatchEntry } from '../../root-analyzer.models';

@Component({
  selector: 'app-preview-step',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  templateUrl: './preview-step.component.html',
  styleUrls: ['./preview-step.component.css'],
})
export class PreviewStepComponent {
  @ViewChild('previewFrameElement') private previewFrameElement?: ElementRef<HTMLDivElement>;

  @Input() selectedFile?: File;
  @Input() form!: FormGroup;
  @Input() backgroundOptions: BackgroundOption[] = [];
  @Input() batchEntries: BatchEntry[] = [];
  @Input() activeBatchIndex = -1;
  @Input() isBatchMode = false;
  @Input() isBatchProcessed = false;
  @Input() batchProcessing = false;
  @Input() processing = false;
  @Input() previewProcessing = false;
  @Input() workflowLocked = false;
  @Input() batchProgress = 0;
  @Input() processingProgressPercent = 0;
  @Input() processingProgressLabel = '';
  @Input() processingStatusMessage = '';
  @Input() showProcessingProgressBar = false;
  @Input() batchNoticeMessage = '';
  @Input() dpiHintMessage = '';
  @Input() previewHistogramImage?: string;
  @Input() previewSegmentedImage?: string;
  @Input() previewForegroundPercent?: number;
  @Input() previewThresholdPercentile?: number;
  @Input() previewDynamicRange?: number;
  @Input() previewPixelSizeMm?: number;
  @Input() showSuggestedThresholdIcon = false;
  @Input() thresholdAtSuggestion = false;
  @Input() thresholdValue = 127;
  @Input() processingButtonLabel = 'Processar';
  @Input() canDownloadCsv = false;
  @Input() showPendingProcessingWarning = false;
  @Input() pendingProcessingWarningMessage = '';
  @Input() cropDisabled = false;
  @Input() isPreviewScrollEnabled = false;
  @Input() previewZoomValue = '1';
  @Input() previewZoomPercent = 100;

  @Output() readonly selectBatchEntry = new EventEmitter<number>();
  @Output() readonly thresholdSliderInput = new EventEmitter<Event>();
  @Output() readonly thresholdNumberInput = new EventEmitter<Event>();
  @Output() readonly decrementThreshold = new EventEmitter<void>();
  @Output() readonly incrementThreshold = new EventEmitter<void>();
  @Output() readonly restoreSuggestedThreshold = new EventEmitter<void>();
  @Output() readonly histogramClick = new EventEmitter<MouseEvent>();
  @Output() readonly back = new EventEmitter<void>();
  @Output() readonly submitStep = new EventEmitter<void>();
  @Output() readonly downloadCsv = new EventEmitter<void>();
  @Output() readonly reprocessCurrentImage = new EventEmitter<void>();
  @Output() readonly discardChanges = new EventEmitter<void>();
  @Output() readonly zoomOutPreview = new EventEmitter<void>();
  @Output() readonly zoomInPreview = new EventEmitter<void>();
  @Output() readonly resetZoomPreview = new EventEmitter<void>();
  @Output() readonly zoomPercentInput = new EventEmitter<Event>();
  @Output() readonly openCropModal = new EventEmitter<void>();
  @Output() readonly previewImageLoad = new EventEmitter<Event>();

  getPreviewFrameSize(): { width: number; height: number } | undefined {
    const frame = this.previewFrameElement?.nativeElement;
    if (!frame) {
      return undefined;
    }

    return {
      width: frame.clientWidth,
      height: frame.clientHeight,
    };
  }

  trackByBatchEntry(index: number, entry: BatchEntry): string {
    return `${index}-${entry.file.name}-${entry.file.size}-${entry.file.lastModified}`;
  }
}
