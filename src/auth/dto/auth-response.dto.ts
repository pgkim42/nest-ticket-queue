import { Expose, Type } from 'class-transformer';
import { IsString, IsUUID, IsEmail, ValidateNested } from 'class-validator';

export class UserInfoDto {
  @Expose()
  @IsUUID()
  id!: string;

  @Expose()
  @IsEmail()
  email!: string;

  @Expose()
  @IsString()
  name!: string;

  @Expose()
  @IsString()
  role!: string;
}

export class AuthResponseDto {
  @Expose()
  @IsString()
  accessToken!: string;

  @Expose()
  @ValidateNested()
  @Type(() => UserInfoDto)
  user!: UserInfoDto;
}
