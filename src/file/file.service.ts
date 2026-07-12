import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
  InternalServerErrorException,
  Inject,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import * as path from 'path';
import * as pdf from 'pdf-to-img';
import {
  decryptKey,
  decryptFile,
  downloadEncryptedFile,
} from '../upload/crypto.util';
import { UpdateFileDto } from './dto/update-file.dto';
import { UploadService } from '../upload/upload.service';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;
const PDF_RENDER_SCALE = 1.5;
const PDF_BATCH_SIZE = 5;

@Injectable()
export class FileService {
  private readonly pdfScanQueues = new Map<string, Promise<void>>();

  constructor(
    private database: DatabaseService,
    private uploadService: UploadService,
    @Inject(CACHE_MANAGER)
    private cacheManager: Cache,
  ) {}

  async getUserFileMetadata(
    userId: string,
    page: number = DEFAULT_PAGE,
    limit: number = DEFAULT_LIMIT,
  ) {
    let parsedPage = page < 1 ? DEFAULT_PAGE : page;
    let parsedLimit = limit < 1 ? DEFAULT_LIMIT : limit;
    parsedLimit = parsedLimit > MAX_LIMIT ? MAX_LIMIT : parsedLimit;

    const skip = (parsedPage - 1) * parsedLimit;

    const [files, total] = await Promise.all([
      this.database.file.findMany({
        where: { userId },
        select: {
          id: true,
          cid: true,
          createdAt: true,
          userId: true,
          metadata: true,
        },
        skip,
        take: parsedLimit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.database.file.count({ where: { userId } }),
    ]);

    return {
      data: files,
      total,
      page: parsedPage,
      limit: parsedLimit,
      totalPages: Math.ceil(total / parsedLimit),
    };
  }

  async openFile(fileId: string, userId: string) {
    const file = await this.database.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.userId !== userId) {
      throw new UnauthorizedException('You do not own this file');
    }

    return this.uploadService.getFile(fileId);
  }

  async getFilePage(
    fileId: string,
    page: number,
    userId: string,
  ): Promise<{
    buffer: Buffer;
    filename: string;
    mimeType: string;
    totalPages: number;
    currentPage: number;
  }> {
    if (page < 1) {
      throw new NotFoundException('Page not found');
    }

    const file = await this.database.file.findUnique({
      where: { id: fileId },
      include: { metadata: true },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.userId !== userId) {
      throw new UnauthorizedException('You do not own this file');
    }

    const cacheKey = `pdf-buffer:${fileId}`;

    let decryptedBuffer = await this.cacheManager.get<Buffer>(cacheKey);

    if (!decryptedBuffer) {
      console.log(`[CACHE MISS] ${fileId}`);

      const aesKey = decryptKey(file.encryptedKey, file.keyIv);

      const encryptedBuffer = await downloadEncryptedFile(file.cid);

      decryptedBuffer = decryptFile(encryptedBuffer, aesKey, file.iv);

      await this.cacheManager.set(cacheKey, decryptedBuffer);
    } else {
      console.log(`[CACHE HIT] ${fileId}`);
    }

    const mimeType = file.metadata?.mimeType ?? 'application/octet-stream';
    const filename = file.metadata?.fileName ?? `file-${fileId}`;
    const totalPages = await this.getTotalPages(
      decryptedBuffer,
      fileId,
      mimeType,
      filename,
    );

    if (page > totalPages) {
      throw new NotFoundException('Page not found');
    }

    let pageResult: { buffer: Buffer; filename: string; mimeType: string };

    if (
      mimeType === 'application/pdf' ||
      filename.toLowerCase().endsWith('.pdf')
    ) {
      pageResult = await this.renderPdfPage(
        decryptedBuffer,
        fileId,
        filename,
        page,
      );
    } else if (mimeType.startsWith('text/') || mimeType === 'application/json') {
      pageResult = this.renderTextPage(decryptedBuffer, filename, page);
    } else if (mimeType.startsWith('image/')) {
      pageResult = {
        buffer: decryptedBuffer,
        filename,
        mimeType,
      };
    } else {
      throw new NotFoundException(
        'Page view is not supported for this file type',
      );
    }

    return {
      ...pageResult,
      totalPages,
      currentPage: page,
    };
  }

  private async getTotalPages(
    buffer: Buffer,
    fileId: string,
    mimeType: string,
    filename: string,
  ): Promise<number> {
    if (mimeType.startsWith('image/')) {
      return 1;
    }

    if (mimeType.startsWith('text/') || mimeType === 'application/json') {
      const lines = buffer.toString('utf8').split(/\r?\n/);
      return Math.max(1, Math.ceil(lines.length / 40));
    }

    if (
      mimeType === 'application/pdf' ||
      filename.toLowerCase().endsWith('.pdf')
    ) {
      const cacheKey = `pdf-page-count:${fileId}`;
      const cachedCount = await this.cacheManager.get<number>(cacheKey);

      if (cachedCount) {
        return cachedCount;
      }

      const document = await pdf.pdf(buffer, { scale: PDF_RENDER_SCALE });

      try {
        const pageCount = document.length;
        await this.cacheManager.set(cacheKey, pageCount);
        return pageCount;
      } finally {
        await document.destroy();
      }
    }

    return 1;
  }

  private enqueuePdfScan<T>(
    fileId: string,
    task: () => Promise<T>,
  ): Promise<T> {
    const previous = this.pdfScanQueues.get(fileId) ?? Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.pdfScanQueues.get(fileId) === settled) {
          this.pdfScanQueues.delete(fileId);
        }
      });

    const settled = next.then(
      () => undefined,
      () => undefined,
    );
    this.pdfScanQueues.set(fileId, settled);

    return next;
  }

  private getPdfPageCacheKey(fileId: string, pageNumber: number): string {
    return `pdf-page:${fileId}:${pageNumber}`;
  }

  private getPageBatchNumbers(
    pageNumber: number,
    batchSize: number = PDF_BATCH_SIZE,
  ): number[] {
    return Array.from({ length: batchSize }, (_, index) => pageNumber + index);
  }

  private async renderPdfPages(
    buffer: Buffer,
    fileId: string,
    pageNumbers: number[],
  ): Promise<Map<number, Buffer>> {
    const rendered = new Map<number, Buffer>();
    const uncachedPageNumbers: number[] = [];

    for (const pageNumber of pageNumbers) {
      const cached = await this.cacheManager.get<Buffer>(
        this.getPdfPageCacheKey(fileId, pageNumber),
      );

      if (cached) {
        rendered.set(pageNumber, cached);
      } else {
        uncachedPageNumbers.push(pageNumber);
      }
    }

    if (uncachedPageNumbers.length === 0) {
      return rendered;
    }

    const document = await pdf.pdf(buffer, { scale: PDF_RENDER_SCALE });

    try {
      const pagesToRender = uncachedPageNumbers.filter(
        (pageNumber) => pageNumber >= 1 && pageNumber <= document.length,
      );

      await Promise.all(
        pagesToRender.map(async (pageNumber) => {
          const pageBuffer = await document.getPage(pageNumber);

          await this.cacheManager.set(
            this.getPdfPageCacheKey(fileId, pageNumber),
            pageBuffer,
          );

          rendered.set(pageNumber, pageBuffer);
        }),
      );
    } finally {
      await document.destroy();
    }

    return rendered;
  }

  private prefetchPdfPageBatch(
    buffer: Buffer,
    fileId: string,
    pageNumber: number,
  ): void {
    void this.enqueuePdfScan(fileId, async () => {
      await this.renderPdfPages(
        buffer,
        fileId,
        this.getPageBatchNumbers(pageNumber),
      );
    });
  }

  private async renderPdfPage(
    buffer: Buffer,
    fileId: string,
    filename: string,
    pageNumber: number,
  ): Promise<{ buffer: Buffer; filename: string; mimeType: string }> {
    const pageCacheKey = this.getPdfPageCacheKey(fileId, pageNumber);

    const cachedPage = await this.cacheManager.get<Buffer>(pageCacheKey);

    if (cachedPage) {
      console.log(`[PAGE CACHE HIT] ${pageNumber}`);

      this.prefetchPdfPageBatch(buffer, fileId, pageNumber);

      return {
        buffer: cachedPage,
        filename: `${path.basename(filename, '.pdf')}-page-${pageNumber}.png`,
        mimeType: 'image/png',
      };
    }

    console.log(`[PAGE CACHE MISS] ${pageNumber}`);

    try {
      return await this.enqueuePdfScan(fileId, async () => {
        const rendered = await this.renderPdfPages(
          buffer,
          fileId,
          this.getPageBatchNumbers(pageNumber),
        );

        const page = rendered.get(pageNumber);

        if (!page) {
          throw new NotFoundException('Page not found');
        }

        return {
          buffer: page,
          filename: `${path.basename(filename, '.pdf')}-page-${pageNumber}.png`,
          mimeType: 'image/png',
        };
      });
    } catch (err) {
      if (err instanceof NotFoundException) {
        throw err;
      }

      throw new InternalServerErrorException('Unable to render PDF page');
    }
  }

  private renderTextPage(
    buffer: Buffer,
    filename: string,
    pageNumber: number,
  ): { buffer: Buffer; filename: string; mimeType: string } {
    const content = buffer.toString('utf8');
    const lines = content.split(/\r?\n/);
    const linesPerPage = 40;
    const pageCount = Math.max(1, Math.ceil(lines.length / linesPerPage));

    if (pageNumber > pageCount) {
      throw new NotFoundException('Page not found');
    }

    const start = (pageNumber - 1) * linesPerPage;
    const pageLines = lines.slice(start, start + linesPerPage);

    return {
      buffer: Buffer.from(pageLines.join('\n'), 'utf8'),
      filename: `${path.basename(filename, path.extname(filename))}-page-${pageNumber}.txt`,
      mimeType: 'text/plain',
    };
  }

  async updateFileMetadata(
    fileId: string,
    userId: string,
    data: UpdateFileDto,
  ) {
    const file = await this.database.file.findUnique({
      where: { id: fileId },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.userId !== userId) {
      throw new UnauthorizedException('You do not own this file');
    }

    return this.database.fileMetadata.update({
      where: { fileId },
      data: {
        fileName: data.fileName,
      },
    });
  }

  async deleteFile(fileId: string, userId: string) {
    const file = await this.database.file.findUnique({
      where: { id: fileId },
      include: { metadata: true, listing: true },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.userId !== userId) {
      throw new UnauthorizedException('You do not own this file');
    }

    return this.database.$transaction(async (tx) => {
      if (file.metadata) {
        await tx.fileMetadata.delete({
          where: { fileId },
        });
      }

      if (file.listing) {
        await tx.listing.delete({
          where: { fileId },
        });
      }

      return tx.file.delete({
        where: { id: fileId },
      });
    });
  }
}
