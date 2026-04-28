declare module "*/pdf.mjs" {
  export interface PageViewportRawDims {
    pageWidth: number;
    pageHeight: number;
    pageX: number;
    pageY: number;
  }

  export interface PDFDocumentProxy {
    numPages: number;
    getPage(pageNumber: number): Promise<PDFPageProxy>;
    destroy(): Promise<void>;
  }
  export interface PDFPageProxy {
    getViewport(params: { scale: number }): PageViewport;
    render(params: { canvasContext: CanvasRenderingContext2D; viewport: PageViewport }): RenderTask;
    getTextContent(): Promise<TextContent>;
  }
  export interface PageViewport {
    width: number;
    height: number;
    scale: number;
    rotation: number;
    transform: number[];
    rawDims: PageViewportRawDims;
  }
  export interface RenderTask {
    promise: Promise<void>;
    destroy(): void;
  }
  export interface TextContent {
    lang?: string;
    styles?: Record<string, unknown>;
    items: Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>;
  }

  export interface TextLayerInit {
    textContentSource: TextContent;
    container: HTMLElement;
    viewport: PageViewport;
  }

  export class TextLayer {
    constructor(init: TextLayerInit);
    render(): Promise<void>;
    update(params: { viewport: PageViewport; onBefore?: (() => void) | null }): void;
    cancel(): void;
  }
  export function getDocument(params: { url: string; withCredentials?: boolean }): { promise: Promise<PDFDocumentProxy>; destroy(): void };
  export const GlobalWorkerOptions: { workerSrc: string };
}
