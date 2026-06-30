import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateFileDto } from './dto/update-file.dto';
import { UploadService } from '../upload/upload.service';

const DEFAULT_PAGE = 1;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

@Injectable()
export class FileService {
  constructor(
    private database: DatabaseService,
    private uploadService: UploadService,
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
