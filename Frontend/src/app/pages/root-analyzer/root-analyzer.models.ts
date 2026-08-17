import { BackgroundMode, RootAnalysisResponse } from '../../services/root-analysis.service';

export interface ProcessedSettingsSnapshot {
  manualDpi: number | null;
  threshold: number | null;
  backgroundMode: BackgroundMode;
  smoothSegmentation: boolean;
  filterComponents: boolean;
  pruneSkeleton: boolean;
}

export interface BackgroundOption {
  value: BackgroundMode;
  label: string;
  description: string;
}

export interface BatchPreviewData {
  dpiHintMessage: string;
  suggestedThreshold?: number;
  width?: number;
  height?: number;
  foregroundPercent?: number;
  thresholdPercentile?: number;
  dynamicRange?: number;
  pixelSizeMm?: number;
}

export interface BatchEntry {
  file: File;
  label: string;
  manualDpi?: number | null;
  threshold?: number | null;
  backgroundMode: BackgroundMode;
  smoothSegmentation: boolean;
  filterComponents: boolean;
  pruneSkeleton: boolean;
  previewData?: BatchPreviewData;
  analysis?: RootAnalysisResponse;
  errorMessage?: string;
  lastProcessedSignature?: string;
  processedSettings?: ProcessedSettingsSnapshot;
}
