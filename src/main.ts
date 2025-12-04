import { NestFactory, Reflector } from '@nestjs/core';
import {
  ValidationPipe,
  ClassSerializerInterceptor,
} from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Serve static files from public directory
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // Enable CORS for demo page
  app.enableCors();

  // Global validation pipe with whitelist and transform options
  // Requirements: 11.1, 11.2
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // Strip properties not in DTO
      transform: true, // Auto-transform payloads to DTO instances
      forbidNonWhitelisted: true, // Throw error for unknown properties
      transformOptions: {
        enableImplicitConversion: true, // Enable type conversion
      },
    }),
  );

  // Global serializer interceptor for consistent response serialization
  // Ensures dates are serialized to ISO 8601 format
  // Requirements: 11.1
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`Application is running on: http://localhost:${port}`);
}
bootstrap();
