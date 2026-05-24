import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../database/database.service';

@Injectable()
export class UserService {
  constructor(private database: DatabaseService) {}

  async getUserFiles(userId: string) {
    return this.database.file.findMany({
      where: {
        userId: userId,
      },
      include: {
        metadata: true,
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }
}
