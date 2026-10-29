import { Module } from '@nestjs/common';
import { PerfisController, PermissoesController } from './perfis.controller';
import { PerfisService } from './perfis.service';

@Module({
  controllers: [PermissoesController, PerfisController],
  providers: [PerfisService],
})
export class PerfisModule {}
