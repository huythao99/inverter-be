import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FirebaseUser } from '../strategies/firebase.strategy';

export const CurrentFirebaseUser = createParamDecorator(
  (data: keyof FirebaseUser | undefined, ctx: ExecutionContext): FirebaseUser | string | boolean | undefined => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as FirebaseUser;

    if (data) {
      return user?.[data];
    }

    return user;
  },
);
