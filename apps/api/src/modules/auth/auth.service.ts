import { randomUUID } from 'node:crypto';
import { createHash } from 'node:crypto';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import type { Request } from 'express';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { AppEnv } from '../../config/env';
import type { AuthUser } from '../../common/types/auth-user.type';
import { extractRequestMeta } from '../../common/utils/request-meta.util';
import { DeliveryLoginDto } from './dto/delivery-login.dto';
import { LoginDto } from './dto/login.dto';
import { RiderLoginDto } from './dto/rider-login.dto';
import { WaiterLoginDto } from './dto/waiter-login.dto';
import type { Prisma } from '@prisma/client';

interface RefreshPayload {
  sub: string;
  jti: string;
  type: 'refresh';
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService<AppEnv, true>,
    private readonly auditService: AuditService,
  ) {}

  async login(dto: LoginDto, request: Request) {
    await this.cleanupRefreshTokens();

    const user = await this.findUserByEmail(dto.email.toLowerCase());

    if (!user || !user.isActive) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    if (this.isOperationalOnlyUser(user.roles)) {
      throw new UnauthorizedException(
        this.hasOperationalRole(user.roles, 'delivery')
          ? 'Usa el acceso de domiciliarios con nombre y código para iniciar tu turno.'
          : 'Usa el acceso de meseros con nombre y código para iniciar tu turno.',
      );
    }

    const validPassword = await compare(dto.password, user.passwordHash);

    if (!validPassword) {
      throw new UnauthorizedException('Credenciales inválidas.');
    }

    return this.completeLogin(user, request, 'LOGIN');
  }

  async waiterLogin(dto: WaiterLoginDto, request: Request) {
    return this.operationalLogin(dto, request, 'waiter', 'WAITER_LOGIN');
  }

  async deliveryLogin(dto: DeliveryLoginDto, request: Request) {
    return this.operationalLogin(dto, request, 'delivery', 'DELIVERY_LOGIN');
  }

  async riderLogin(dto: RiderLoginDto, request: Request) {
    return this.operationalLogin(dto, request, 'delivery', 'RIDER_LOGIN');
  }

  private async operationalLogin(
    dto: { name: string; accessCode: string },
    request: Request,
    expectedRole: 'waiter' | 'delivery',
    action: 'WAITER_LOGIN' | 'DELIVERY_LOGIN' | 'RIDER_LOGIN',
  ) {
    await this.cleanupRefreshTokens();

    const accessName = this.normalizeAccessName(dto.name);
    const user = await this.findOperationalByAccessName(accessName);

    if (!user || !user.isActive || !user.accessCodeHash) {
      throw new UnauthorizedException('Nombre o código de acceso inválido.');
    }

    if (!this.hasOperationalRole(user.roles, expectedRole)) {
      throw new UnauthorizedException(
        expectedRole === 'delivery'
          ? 'Este acceso está reservado para domiciliarios.'
          : 'Este acceso está reservado para meseros.',
      );
    }

    const validAccessCode = await compare(dto.accessCode.trim(), user.accessCodeHash);

    if (!validAccessCode) {
      throw new UnauthorizedException('Nombre o código de acceso inválido.');
    }

    return this.completeLogin(user, request, action);
  }

  async refresh(refreshToken: string, request: Request) {
    if (!refreshToken) {
      throw new UnauthorizedException('El token de actualización es obligatorio.');
    }

    try {
      const payload = await this.jwtService.verifyAsync<RefreshPayload>(refreshToken, {
        secret: this.configService.get('JWT_REFRESH_SECRET', { infer: true }),
      });

      if (payload.type !== 'refresh') {
        throw new UnauthorizedException('El token de actualización no es válido.');
      }

      const tokenHash = this.hashToken(refreshToken);

      // Buscar el token INCLUYENDO revocados para detectar reuso (H-06)
      const existingToken = await this.prisma.refreshToken.findFirst({
        where: {
          userId: payload.sub,
          tokenHash,
        },
        include: {
          user: {
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
          },
        },
      });

      if (!existingToken) {
        // Token no encontrado: podria ser invalido o ya limpiado tras revocacion.
        // Como heuristica, revisamos si el usuario tiene tokens revocados recientes.
        const recentlyRevoked = await this.prisma.refreshToken.findFirst({
          where: {
            userId: payload.sub,
            revokedAt: { not: null },
            expiresAt: { gt: new Date() },
          },
        });

        if (recentlyRevoked) {
          // Posible reuso de un token ya limpiado. Invalidamos todo por seguridad.
          await this.handleTokenReuse(payload.sub, request);
        }

        throw new UnauthorizedException('El token de actualización no es válido.');
      }

      // REUSO DETECTADO: el token existe pero ya fue revocado
      if (existingToken.revokedAt) {
        await this.handleTokenReuse(payload.sub, request);
        throw new UnauthorizedException('El token de actualización no es válido.');
      }

      // Token expirado
      if (existingToken.expiresAt <= new Date()) {
        throw new UnauthorizedException('El token de actualización no es válido.');
      }

      // Usuario inactivo
      if (!existingToken.user.isActive) {
        throw new UnauthorizedException('El token de actualización no es válido.');
      }

      // Rotacion: revocar el token actual y emitir uno nuevo
      await this.prisma.refreshToken.update({
        where: { id: existingToken.id },
        data: { revokedAt: new Date() },
      });

      const authUser = this.toAuthUser(existingToken.user);
      const tokens = await this.issueTokens(this.prisma, authUser, request);

      return {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        user: authUser,
      };
    } catch (error) {
      throw new UnauthorizedException('El token de actualización no es válido.', {
        cause: error,
      });
    }
  }

  async logout(refreshToken: string | undefined, userId?: string) {
    if (refreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: {
          tokenHash: this.hashToken(refreshToken),
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    } else if (userId) {
      await this.prisma.refreshToken.updateMany({
        where: {
          userId,
          revokedAt: null,
        },
        data: { revokedAt: new Date() },
      });
    }

    return { success: true };
  }

  getRefreshTokenMaxAgeMs() {
    return this.parseDurationToMs(
      this.configService.get('JWT_REFRESH_EXPIRES_IN', { infer: true }),
    );
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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

    if (!user) {
      throw new NotFoundException('No se encontró el usuario.');
    }

    return this.toAuthUser(user);
  }

  private async issueTokens(
    client: PrismaService | Prisma.TransactionClient,
    user: AuthUser,
    request: Request,
  ) {
    const accessToken = await this.jwtService.signAsync(
      {
        ...user,
        type: 'access',
      },
      {
        secret: this.configService.get('JWT_ACCESS_SECRET', { infer: true }),
        expiresIn: this.configService.get('JWT_ACCESS_EXPIRES_IN', { infer: true }),
      },
    );

    const jti = randomUUID();
    const refreshToken = await this.jwtService.signAsync(
      {
        sub: user.sub,
        jti,
        type: 'refresh',
      },
      {
        secret: this.configService.get('JWT_REFRESH_SECRET', { infer: true }),
        expiresIn: this.configService.get('JWT_REFRESH_EXPIRES_IN', { infer: true }),
      },
    );

    const expiresAt = new Date(Date.now() + this.getRefreshTokenMaxAgeMs());
    const meta = extractRequestMeta(request);

    await client.refreshToken.create({
      data: {
        userId: user.sub,
        tokenHash: this.hashToken(refreshToken),
        expiresAt,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      },
    });

    await this.pruneActiveRefreshTokens(client, user.sub);

    return { accessToken, refreshToken };
  }

  private async cleanupRefreshTokens() {
    // Solo elimina tokens expirados. Los tokens revocados se conservan para
    // detectar reuso (H-06). Se limpian cuando expiran naturalmente.
    await this.prisma.refreshToken.deleteMany({
      where: {
        expiresAt: {
          lte: new Date(),
        },
      },
    });
  }

  private async pruneActiveRefreshTokens(
    client: PrismaService | Prisma.TransactionClient,
    userId: string,
  ) {
    const maxActiveTokens = this.configService.get('MAX_ACTIVE_REFRESH_TOKENS_PER_USER', {
      infer: true,
    });

    const tokens = await client.refreshToken.findMany({
      where: {
        userId,
        revokedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    if (tokens.length <= maxActiveTokens) {
      return;
    }

    const tokensToRevoke = tokens.slice(maxActiveTokens);
    await client.refreshToken.updateMany({
      where: {
        id: {
          in: tokensToRevoke.map((token) => token.id),
        },
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  private toAuthUser(user: {
    id: string;
    email: string;
    fullName: string;
    sessionVersion: number;
    lastLoginAt?: Date | null;
    accessName?: string | null;
    roles: Array<{
      role: {
        name: string;
        permissions: Array<{ permission: { code: string } }>;
      };
    }>;
  }): AuthUser {
    const roles = user.roles.map(({ role }) => role.name);
    const permissions = user.roles.flatMap(({ role }) =>
      role.permissions.map(({ permission }) => permission.code),
    );

    return {
      sub: user.id,
      email: user.email,
      fullName: user.fullName,
      sessionVersion: user.sessionVersion,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      roles,
      permissions: [...new Set(permissions)],
    };
  }

  private async completeLogin(
    user: NonNullable<Awaited<ReturnType<AuthService['findUserByEmail']>>>,
    request: Request,
    action: 'LOGIN' | 'WAITER_LOGIN' | 'DELIVERY_LOGIN' | 'RIDER_LOGIN',
  ) {
    const { authUser, tokens } = await this.prisma.$transaction(async (tx) => {
      const currentUser = await tx.user.findUnique({
        where: { id: user.id },
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

      if (!currentUser || !currentUser.isActive) {
        throw new UnauthorizedException('Credenciales inválidas.');
      }

      const authUser = this.toAuthUser(currentUser);
      const tokens = await this.issueTokens(tx, authUser, request);

      await tx.user.update({
        where: { id: currentUser.id },
        data: { lastLoginAt: new Date() },
      });

      return { authUser, tokens };
    });

    const meta = extractRequestMeta(request);
    await this.auditService.log({
      userId: user.id,
      action,
      module: 'auth',
      entity: 'user',
      entityId: user.id,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: authUser,
    };
  }

  private async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({
      where: { email },
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
  }

  private async findOperationalByAccessName(accessName: string) {
    return this.prisma.user.findUnique({
      where: { accessName },
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
  }

  private normalizeAccessName(value: string) {
    return value.trim().toLowerCase();
  }

  private hasOperationalRole(
    roles: Array<{
      role: {
        name: string;
      };
    }>,
    expectedRole: 'waiter' | 'delivery',
  ) {
    return roles.some(({ role }) => role.name === expectedRole);
  }

  private isOperationalOnlyUser(
    roles: Array<{
      role: {
        name: string;
      };
    }>,
  ) {
    const roleNames = roles.map(({ role }) => role.name);
    return (
      roleNames.length > 0 &&
      roleNames.every((roleName) => roleName === 'waiter' || roleName === 'delivery') &&
      roleNames.every((roleName) => roleName === roleNames[0])
    );
  }

  private hashToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Maneja la deteccion de reuso de refresh token (H-06):
   * 1. Revoca TODOS los tokens activos del usuario
   * 2. Incrementa sessionVersion para invalidar JWTs actuales
   * 3. Registra evento de auditoria
   */
  private async handleTokenReuse(userId: string, request: Request) {
    await this.prisma.refreshToken.updateMany({
      where: {
        userId,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });

    await this.prisma.user.update({
      where: { id: userId },
      data: { sessionVersion: { increment: 1 } },
    });

    const meta = extractRequestMeta(request);
    await this.auditService.log({
      userId,
      action: 'REFRESH_TOKEN_REUSE_DETECTED',
      module: 'auth',
      entity: 'refresh_token',
      entityId: userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  private parseDurationToMs(value: string) {
    const match = /^(\d+)(ms|s|m|h|d)$/i.exec(value.trim());

    if (!match) {
      throw new BadRequestException('El formato de duración no es válido.');
    }

    const amount = Number(match[1] ?? 0);
    const unit = (match[2] ?? '').toLowerCase() as 'ms' | 's' | 'm' | 'h' | 'd';
    const multipliers: Record<'ms' | 's' | 'm' | 'h' | 'd', number> = {
      ms: 1,
      s: 1000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };

    return amount * multipliers[unit];
  }
}
