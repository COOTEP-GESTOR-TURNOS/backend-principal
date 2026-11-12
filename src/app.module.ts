import { Module } from '@nestjs/common';
import { AuditoriaModule } from './auditoria/auditoria.module';
import { SaludController } from './compartido/infrastructure/http/salud.controller';
import { InfraestructuraModule } from './compartido/infrastructure/infraestructura.module';
import { IdentidadModule } from './identidad/identidad.module';
import { TurnosModule } from './turnos/turnos.module';

@Module({
  imports: [InfraestructuraModule, TurnosModule, IdentidadModule, AuditoriaModule],
  controllers: [SaludController],
})
export class AppModule {}
