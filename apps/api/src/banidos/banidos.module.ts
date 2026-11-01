import { Module } from '@nestjs/common';
import { BanidosController } from './banidos.controller';
import { BanidosService } from './banidos.service';

@Module({
  controllers: [BanidosController],
  providers: [BanidosService],
  exports: [BanidosService],
})
export class BanidosModule {}
