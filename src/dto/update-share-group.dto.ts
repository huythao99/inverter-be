import { PartialType } from '@nestjs/mapped-types';
import { CreateShareGroupDto } from './create-share-group.dto';

export class UpdateShareGroupDto extends PartialType(CreateShareGroupDto) {}
