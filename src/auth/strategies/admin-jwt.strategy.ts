import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Admin, AdminDocument } from '../../models/admin.schema';

export interface AdminJwtPayload {
  sub: string;
  username: string;
  role: string;
}

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    private configService: ConfigService,
    @InjectModel(Admin.name) private adminModel: Model<AdminDocument>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>(
        'CMS_JWT_SECRET',
        'cms_default_secret_change_in_production',
      ),
    });
  }

  async validate(payload: AdminJwtPayload): Promise<AdminDocument> {
    const admin = await this.adminModel
      .findOne({ _id: payload.sub, isActive: true })
      .exec();

    if (!admin) {
      throw new UnauthorizedException('Admin not found or inactive');
    }

    return admin;
  }
}
