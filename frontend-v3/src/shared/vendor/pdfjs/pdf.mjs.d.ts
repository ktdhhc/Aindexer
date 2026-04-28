declare module "*/pdf.mjs" {
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
    transform: number[];
  }
  export interface RenderTask {
    promise: Promise<void>;
    destroy(): void;
  }
  export interface TextContent {
    items: Array<{
      str: string;
      transform: number[];
      width: number;
      height: number;
    }>;
  }
  export function getDocument(params: { url: string; withCredentials?: boolean }): { promise: Promise<PDFDocumentProxy>; destroy(): void };
  export const GlobalWorkerOptions: { workerSrc: string };
}
