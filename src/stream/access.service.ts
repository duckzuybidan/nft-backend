import {
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class AccessService {
  constructor(private database: DatabaseService) {}

  async resolveFileId(tokenOrFileId: string): Promise<string> {
    const file = await this.database.file.findUnique({
      where: { id: tokenOrFileId },
      select: { id: true },
    });

    if (file) {
      return file.id;
    }

    const listing = await this.database.listing.findFirst({
      where: { tokenId: tokenOrFileId },
      select: { fileId: true },
    });

    if (listing) {
      return listing.fileId;
    }

    throw new NotFoundException('Content not found for the given identifier');
  }

  async assertCanAccess(fileId: string, userId: string) {
    const file = await this.database.file.findUnique({
      where: { id: fileId },
      select: { id: true, userId: true },
    });

    if (!file) {
      throw new NotFoundException('File not found');
    }

    if (file.userId === userId) {
      return file;
    }

    throw new UnauthorizedException(
      'You do not have access to stream this content',
    );
  }
}
