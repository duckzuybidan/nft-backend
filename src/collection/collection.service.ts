import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class CollectionService {
  constructor(private database: DatabaseService) {}

  async getFilesByUserId(userId: string) {
    const files = await this.database.file.findMany({
      where: { userId },
      include: {
        metadata: true,
        user: {
          select: {
            walletAddress: true,
          },
        },
      },
    });

    return files.map((file) => ({
      id: file.id,
      metadata: file.metadata,
      createdAt: file.createdAt,
      userId: file.userId,
      owner: file.user.walletAddress,
    }));
  }
}
