import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

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
}
