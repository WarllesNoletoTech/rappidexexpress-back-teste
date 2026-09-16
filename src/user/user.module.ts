import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { IfoodModule } from '../ifood/ifood.module';

@Module({
  imports: [IfoodModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
