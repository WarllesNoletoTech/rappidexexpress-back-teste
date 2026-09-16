import { PostgresCompatRepository } from '../postgres-compat.repository';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { v4 as uuid } from 'uuid';
import { CityEntity } from '../entities/city.entity';

const DEFAULT_CITY = {
  name: 'Redenção',
  state: 'PA',
};

@Injectable()
export class CitySeedService implements OnModuleInit {
  constructor(
    @InjectRepository(CityEntity)
    private readonly cityRepository: PostgresCompatRepository<CityEntity>,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.seedDefaultCitySafely();
  }

  async seedDefaultCitySafely(): Promise<void> {
    const cityExists = await this.cityRepository.findOne({
      where: { name: DEFAULT_CITY.name, state: DEFAULT_CITY.state },
    });

    if (!cityExists) {
      await this.cityRepository.insert({ id: uuid(), ...DEFAULT_CITY });
    }
  }
}
