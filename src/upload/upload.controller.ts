import {
  Controller,
  Post,
  Get,
  Param,
  UploadedFile,
  UseInterceptors,
  Res,
  UseGuards,
  Req,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { UploadService } from './upload.service';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';

@Controller('upload')
@UseGuards(AuthGuard)
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
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.uploadService.processFile(file, req.user.sub);
  }

  @Get(':id')
  async getFile(@Param('id') id: string, @Res() res: Response) {
    const { buffer, filename } = await this.uploadService.getFile(id);

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    res.send(buffer);
  }
}
