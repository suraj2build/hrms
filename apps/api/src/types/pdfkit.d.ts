declare module 'pdfkit' {
  class PDFDocument {
    constructor(options?: Record<string, unknown>)
    pipe(destination: NodeJS.WritableStream): this
    end(): void
    on(event: string, listener: (...args: any[]) => any): this
    fontSize(size: number): this
    font(font: string): this
    text(text: string, options?: Record<string, unknown>): this
    moveDown(lines?: number): this
    moveTo(x: number, y: number): this
    lineTo(x: number, y: number): this
    stroke(): this
    fillColor(color: string): this
    rect(x: number, y: number, w: number, h: number): this
    fill(color?: string): this
    page: { width: number; height: number; margins: Record<string, number> }
    y: number
    x: number
    addPage(options?: Record<string, unknown>): this
    image(src: string | Buffer, options?: Record<string, unknown>): this
  }
  export = PDFDocument
}
