import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MongoRepository } from 'typeorm';
import { addHours } from 'date-fns';
import { UserEntity } from './database/entities/user.entity';
import { UserType } from './shared/constants/enums.constants';
import { UserRequest } from './shared/interfaces';

const AUTOCLICK_BLOCK_REASON = 'Uso suspeito de autoclick';

@Injectable()
export class SecurityService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: MongoRepository<UserEntity>,
  ) {}

  async reportAutoclick(user: UserRequest) {
    const currentUser = await this.userRepository.findOneBy({ id: user.id });

    if (!currentUser) {
      throw new BadRequestException('Usuário não encontrado.');
    }

    if (currentUser.type !== UserType.MOTOBOY) {
      throw new UnauthorizedException('Recurso disponível somente para motoboys.');
    }

    await this.userRepository.save({
      ...currentUser,
      blocked: true,
      blockedReason: AUTOCLICK_BLOCK_REASON,
      blockedAt: addHours(new Date(), -3),
      blockedBySystem: true,
      updatedAt: addHours(new Date(), -3),
    });

    return { status: 200, message: 'Tentativa de autoclick registrada.' };
  }
}
