import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { Request } from 'express';
import type { AppEnv } from '../../config/env';
import type { AuthUser } from '../../common/types/auth-user.type';
import { PrismaService } from '../../prisma/prisma.service';

interface JwtPayload extends AuthUser {
  type: 'access';
}

function extractTokenFromCookieOrHeader(request: Request): string | null {
  const cookieToken = request.cookies?.access_token as string | undefined;

  if (cookieToken) {
    return cookieToken;
  }

  return ExtractJwt.fromAuthHeaderAsBearerToken()(request);
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService<AppEnv, true>,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: extractTokenFromCookieOrHeader,
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_ACCESS_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload) {
    if (payload.type !== 'access') {
      throw new UnauthorizedException('El token de acceso no es válido.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: {
                    permission: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive || user.sessionVersion !== payload.sessionVersion) {
      throw new UnauthorizedException('La sesión ya no es válida.');
    }

    return {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      accessName: user.accessName,
      sessionVersion: user.sessionVersion,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      roles: user.roles.map(({ role }) => role.name),
      permissions: [...new Set(user.roles.flatMap(({ role }) => role.permissions.map(({ permission }) => permission.code)))],
    };
  }
}
