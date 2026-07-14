import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { configureFfmpeg } from './common/ffmpeg.config';

async function bootstrap() {
  configureFfmpeg();
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.CLIENT_URL,
    credentials: true,
    exposedHeaders: ['X-Total-Pages', 'X-Current-Page'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Range'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  await app.listen(process.env.PORT ?? 8000);
}
bootstrap();
