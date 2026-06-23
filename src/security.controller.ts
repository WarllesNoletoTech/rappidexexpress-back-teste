import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './authenticator/guards/jwt-auth.guard';
import { User } from './shared/decorators';
import { UserRequest } from './shared/interfaces';
import { SecurityService } from './security.service';

@Controller('security')
export class SecurityController {
  constructor(private readonly securityService: SecurityService) {}

  @Post('autoclick-detected')
  @UseGuards(JwtAuthGuard)
  async autoclickDetected(@User() user: UserRequest, @Body() _data: unknown) {
    return this.securityService.reportAutoclick(user);
  }
}
