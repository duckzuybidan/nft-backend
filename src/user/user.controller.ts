import { Controller, Get, UseGuards, Req } from '@nestjs/common';
import { UserService } from './user.service';
import { AuthGuard } from '../auth/auth.guard';
import { Request } from 'express';

@Controller('user')
@UseGuards(AuthGuard)
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get('files')
  async getMyFiles(@Req() req: Request & { user: { sub: string } }) {
    return this.userService.getUserFiles(req.user.sub);
  }

}
