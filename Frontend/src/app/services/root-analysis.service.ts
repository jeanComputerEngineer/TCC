import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

export interface RootAnalysisRequest {
  file: File;
  manualDpi?: number;
  threshold?: number;
  backgroundMode?: BackgroundMode;
  smoothSegmentation?: boolean;
  filterComponents?: boolean;
  pruneSkeleton?: boolean;
}

export type BackgroundMode = 'auto' | 'light' | 'dark';

export interface RootAnalysisResponse {
  dpi: number;
  dpiReliable?: boolean;
  dpiSource?: string;
  pixelSizeMm: number;
  threshold: number;
  thresholdMethod?: string;
  preprocessingMode?: string | null;
  smoothSegmentation?: boolean;
  filterComponents?: boolean;
  pruneSkeleton?: boolean;
  backgroundMode?: BackgroundMode;
  rawLengthMm?: number;
  lengthCorrectionMode?: string | null;
  lengthMm: number;
  branchPoints: number;
  averageDiameterMm: number;
  areaMm2: number;
  grayscaleImage: string;
  segmentedImage: string;
  skeletonImage: string;
}

export interface PreviewResponse {
  width: number;
  height: number;
  grayPixels: string;
  smoothedPixels: string;
  suggestedThreshold: number;
  preprocessingMode?: string | null;
}

export interface ProbeDpiResponse {
  dpi: number;
  dpiReliable?: boolean;
  dpiSource?: string;
}

export interface CropRequest {
  xRatio: number;
  yRatio: number;
  widthRatio: number;
  heightRatio: number;
  dpi?: number;
}

export interface CropResponse {
  croppedImage: string;
}

interface ProcessadorGlobal {
  backendBaseUrl?: string;
}

declare global {
  interface Window {
    PROCESSADOR_BACKEND_URL?: string;
    processador?: ProcessadorGlobal;
  }
}

@Injectable({
  providedIn: 'root'
})
export class RootAnalysisService {
  private readonly baseUrl = this.resolveBaseUrl();

  constructor(private readonly http: HttpClient) {}

  private resolveBaseUrl(): string {
    if (typeof window === 'undefined') {
      return '/api';
    }
    const fromInjection = window.processador?.backendBaseUrl;
    const fromLegacy = window.PROCESSADOR_BACKEND_URL;
    return fromInjection ?? fromLegacy ?? '/api';
  }

  analyze(request: RootAnalysisRequest): Observable<RootAnalysisResponse> {
    const formData = new FormData();
    formData.append('file', request.file);
    if (request.manualDpi !== undefined && request.manualDpi !== null) {
      formData.append('manual_dpi', String(request.manualDpi));
    }
    if (request.threshold !== undefined && request.threshold !== null) {
      formData.append('threshold', String(request.threshold));
    }
    if (request.backgroundMode) {
      formData.append('background_mode', request.backgroundMode);
    }
    if (request.smoothSegmentation !== undefined && request.smoothSegmentation !== null) {
      formData.append('smooth_segmentation', String(request.smoothSegmentation));
    }
    if (request.filterComponents !== undefined && request.filterComponents !== null) {
      formData.append('filter_components', String(request.filterComponents));
    }
    if (request.pruneSkeleton !== undefined && request.pruneSkeleton !== null) {
      formData.append('prune_skeleton_enabled', String(request.pruneSkeleton));
    }
    return this.http.post<RootAnalysisResponse>(`${this.baseUrl}/process`, formData);
  }

  probeDpi(file: File, manualDpi?: number): Observable<ProbeDpiResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (manualDpi !== undefined && manualDpi !== null) {
      formData.append('manual_dpi', String(manualDpi));
    }
    return this.http.post<ProbeDpiResponse>(`${this.baseUrl}/probe-dpi`, formData);
  }

  preview(file: File, smoothSegmentation?: boolean): Observable<PreviewResponse> {
    const formData = new FormData();
    formData.append('file', file);
    if (smoothSegmentation !== undefined && smoothSegmentation !== null) {
      formData.append('smooth_segmentation', String(smoothSegmentation));
    }
    return this.http.post<PreviewResponse>(`${this.baseUrl}/preview`, formData);
  }

  crop(file: File, selection: CropRequest): Observable<CropResponse> {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('x_ratio', String(selection.xRatio));
    formData.append('y_ratio', String(selection.yRatio));
    formData.append('width_ratio', String(selection.widthRatio));
    formData.append('height_ratio', String(selection.heightRatio));
    if (selection.dpi !== undefined && selection.dpi !== null) {
      formData.append('dpi', String(selection.dpi));
    }
    return this.http.post<CropResponse>(`${this.baseUrl}/crop`, formData);
  }
}
