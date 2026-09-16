import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthenticatorService } from './authenticator.service';
import { AuthenticatorController } from './authenticator.controller';
import { JwtStrategy } from './strategies/jwt.strategy';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET_KEY'),
      }),
      inject: [ConfigService],
    }),
  ],
  providers: [AuthenticatorService, JwtStrategy],
  controllers: [AuthenticatorController],
})
export class AuthenticatorModule {}
