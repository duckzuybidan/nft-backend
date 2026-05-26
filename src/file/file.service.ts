import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';
import { UpdateFileDto } from './dto/update-file.dto';

@Injectable()
export class FileService {
  constructor(private database: DatabaseService) {}

  async getUserFileMetadata(userId: string) {
    return this.database.file.findMany({
      where: { userId },
      select: {
        id: true,
        cid: true,
        createdAt: true,
        userId: true,
        metadata: true,
      },
    });
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
