import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import type { AppEnv } from '../../config/env';
import { AuthService } from './auth.service';
import { DeliveryLoginDto } from './dto/delivery-login.dto';
import { LoginDto } from './dto/login.dto';
import { RiderLoginDto } from './dto/rider-login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { WaiterLoginDto } from './dto/waiter-login.dto';

const REFRESH_COOKIE = process.env.REFRESH_TOKEN_COOKIE_NAME || 'refresh_token';

const isAutomatedTestEnvironment =
  process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID) || Boolean(process.env.TEST_DATABASE_URL);
const loginThrottleLimit = isAutomatedTestEnvironment ? 500 : 5;
const accessCodeThrottleLimit = isAutomatedTestEnvironment ? 500 : 10;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService<AppEnv, true>,
  ) {}

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      ttl: 60_000,
      // In test we relax only the login window to avoid false negatives from repeated E2E authentication.
      limit: loginThrottleLimit,
    },
  })
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.login(dto, request);
    this.attachRefreshCookie(response, result.refreshToken);
    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      ttl: 60_000,
      limit: accessCodeThrottleLimit,
    },
  })
  @Post('waiter-login')
  async waiterLogin(
    @Body() dto: WaiterLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.waiterLogin(dto, request);
    this.attachRefreshCookie(response, result.refreshToken);
    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      ttl: 60_000,
      limit: accessCodeThrottleLimit,
    },
  })
  @Post('delivery-login')
  async deliveryLogin(
    @Body() dto: DeliveryLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.deliveryLogin(dto, request);
    this.attachRefreshCookie(response, result.refreshToken);
    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @UseGuards(ThrottlerGuard)
  @Throttle({
    default: {
      ttl: 60_000,
      limit: accessCodeThrottleLimit,
    },
  })
  @Post('rider-login')
  async riderLogin(
    @Body() dto: RiderLoginDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.authService.riderLogin(dto, request);
    this.attachRefreshCookie(response, result.refreshToken);
    return {
      accessToken: result.accessToken,
      user: result.user,
    };
  }

  @Public()
  @Get('debug-cookie-presence')
  debugCookiePresence(@Req() request: Request) {
    return {
      hasRefreshCookie: REFRESH_COOKIE in (request.cookies ?? {}),
      cookieNames: Object.keys(request.cookies ?? {}).filter((n) => !n.includes('token')),
      host: request.hostname ?? 'unknown',
      origin: request.get('origin') ?? 'none',
      path: request.path,
    };
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const token =
      dto.refreshToken ??
      request.cookies?.[this.configService.get('REFRESH_TOKEN_COOKIE_NAME', { infer: true })];
    try {
      const result = await this.authService.refresh(token, request);
      this.attachRefreshCookie(response, result.refreshToken);
      return {
        accessToken: result.accessToken,
        user: result.user,
      };
    } catch (error) {
      this.clearRefreshCookie(response);
      throw error;
    }
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
    @CurrentUser('sub') userId: string,
  ) {
    await this.authService.logout(
      request.cookies?.[this.configService.get('REFRESH_TOKEN_COOKIE_NAME', { infer: true })],
      userId,
    );
    this.clearRefreshCookie(response);
    return { success: true };
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser('sub') userId: string) {
    return this.authService.me(userId);
  }

  private attachRefreshCookie(response: Response, token: string) {
    const cookieName = this.configService.get('REFRESH_TOKEN_COOKIE_NAME', { infer: true });
    response.cookie(cookieName, token, {
      httpOnly: true,
      secure: this.configService.get('COOKIE_SECURE', { infer: true }),
      sameSite: this.configService.get('COOKIE_SAME_SITE', { infer: true }),
      domain: this.configService.get('COOKIE_DOMAIN', { infer: true }),
      path: '/api/auth',
      maxAge: this.authService.getRefreshTokenMaxAgeMs(),
    });
  }

  private clearRefreshCookie(response: Response) {
    response.clearCookie(this.configService.get('REFRESH_TOKEN_COOKIE_NAME', { infer: true }), {
      httpOnly: true,
      secure: this.configService.get('COOKIE_SECURE', { infer: true }),
      sameSite: this.configService.get('COOKIE_SAME_SITE', { infer: true }),
      domain: this.configService.get('COOKIE_DOMAIN', { infer: true }),
      path: '/api/auth',
    });
  }
}
