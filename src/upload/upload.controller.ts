import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UploadService } from './upload.service';
import type { Response } from 'express';

@Controller('upload')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post()
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: './uploads',
        filename: (req, file, cb) => {
          const name = Date.now() + '-' + file.originalname;
          cb(null, name);
        },
      }),
    }),
  )
  async upload(@UploadedFile() file: Express.Multer.File) {
    return this.uploadService.processFile(file);
  }

  @Get(':id')
  async getFile(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.uploadService.getFile(id);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.send(buffer);
  }
}
