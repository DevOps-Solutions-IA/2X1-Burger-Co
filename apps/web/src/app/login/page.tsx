'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { useAuth } from '@/features/auth/auth-provider';
import { resolveDefaultRoute } from '@/features/auth/access-control';

const formSchema = z.object({
  email: z.string().email('Escribe un correo válido.'),
  password: z.string().min(8, 'La contraseña debe tener al menos 8 caracteres.'),
});

type FormValues = z.infer<typeof formSchema>;

export default function LoginPage() {
  const router = useRouter();
  const { user, loading, login } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      email: '',
      password: '',
    },
  });

  useEffect(() => {
    if (!loading && user) {
      router.replace(resolveDefaultRoute(user));
    }
  }, [loading, router, user]);

  return (
    <div
      data-testid="login-total-black-shell"
      className="relative min-h-screen overflow-x-hidden bg-black px-4 py-5 text-stone-50 sm:px-6 lg:py-6"
    >
      <div className="relative mx-auto grid min-h-[calc(100vh-2.5rem)] max-w-6xl items-center gap-8 lg:grid-cols-[1fr_420px] lg:gap-12">
        <section
          data-testid="login-brand-panel"
          className="flex items-center justify-center px-4 py-8 lg:py-0"
          aria-labelledby="login-brand-heading"
        >
          <div className="w-full max-w-[480px]">
            <Image
              src="/brand/sidebar-logo.png"
              alt="2X1 Burger Co."
              width={500}
              height={180}
              priority
              className="h-auto w-full object-contain"
            />
          </div>
        </section>

        <section className="flex items-center justify-center px-4">
          <Card className="relative w-full max-w-lg overflow-hidden border-brand-500/20 bg-black p-8 text-stone-50 lg:p-10">
            <p className="text-sm uppercase tracking-[0.28em] text-brand-500 font-bold">Acceso</p>
            <h2 className="mt-3 text-[1.9rem] font-bold text-white">Iniciar sesión</h2>

            <form
              className="mt-8 space-y-5"
              onSubmit={handleSubmit(async (values) => {
                try {
                  setError(null);
                  const user = await login(values.email, values.password);
                  router.push(resolveDefaultRoute(user));
                } catch (caughtError) {
                  setError(caughtError instanceof Error ? caughtError.message : 'No pudimos iniciar la sesión. Intenta de nuevo.');
                }
              })}
            >
              <div>
                <label className="mb-2 block text-sm font-medium text-stone-200">Correo electrónico</label>
                <Input
                  data-testid="login-email"
                  {...register('email')}
                  placeholder="tu@correo.com"
                  className="border-white/12 bg-black text-stone-50 placeholder:text-stone-500 focus:border-brand-500 focus:bg-black focus:ring-brand-500/20"
                />
                {errors.email ? <p className="mt-2 text-sm text-red-400">{errors.email.message}</p> : null}
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-stone-200">Contraseña</label>
                <Input
                  data-testid="login-password"
                  {...register('password')}
                  type="password"
                  placeholder="Ingresa tu contraseña"
                  className="border-white/12 bg-black text-stone-50 placeholder:text-stone-500 focus:border-brand-500 focus:bg-black focus:ring-brand-500/20"
                />
                {errors.password ? <p className="mt-2 text-sm text-red-400">{errors.password.message}</p> : null}
              </div>

              {error ? (
                <p
                  role="alert"
                  data-testid="login-error"
                  className="rounded-2xl border border-red-400/25 bg-red-950/45 px-4 py-3 text-sm text-red-300"
                >
                  {error}
                </p>
              ) : null}

              <Button
                data-testid="login-submit"
                type="submit"
                size="lg"
                className="w-full"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Entrando...' : 'Entrar al sistema'}
              </Button>
            </form>

            <div className="mt-5 flex items-center justify-center gap-4 text-sm font-medium">
              <Link href="/waiter/login" className="text-brand-500 transition hover:text-brand-400 font-semibold">
                Acceso para meseros
              </Link>
              <span className="text-stone-600">•</span>
              <Link href="/delivery/login" className="text-brand-500 transition hover:text-brand-400 font-semibold">
                Acceso para domiciliarios
              </Link>
            </div>
          </Card>
        </section>
      </div>
    </div>
  );
}
