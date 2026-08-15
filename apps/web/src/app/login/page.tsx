'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { zodResolver } from '@hookform/resolvers/zod';
import { ChartNoAxesCombined, ChefHat, ShieldCheck } from 'lucide-react';
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
    <main
      id="main-content"
      data-testid="login-total-black-shell"
      className="relative min-h-screen overflow-x-hidden bg-black px-4 py-5 text-stone-50 sm:px-6 lg:py-6"
    >
      <div className="pointer-events-none absolute inset-0 opacity-40" aria-hidden="true">
        <div className="absolute -left-24 top-1/3 h-72 w-72 rounded-full bg-brand-500/15 blur-3xl" />
        <div className="absolute right-0 top-0 h-px w-1/2 bg-gradient-to-l from-brand-500/70 to-transparent" />
      </div>
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
            <div className="mt-8 grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3" aria-label="Capacidades del centro operativo">
              {[
                { label: 'Operación', icon: ChefHat },
                { label: 'Inteligencia', icon: ChartNoAxesCombined },
                { label: 'Acceso por rol', icon: ShieldCheck },
              ].map(({ label, icon: Icon }) => (
                <div key={label} className="flex min-h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-stone-300">
                  <Icon className="h-4 w-4 text-brand-500" aria-hidden="true" />
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="flex items-center justify-center px-4">
          <Card className="relative w-full max-w-lg overflow-hidden border-brand-500/20 bg-black p-8 text-stone-50 lg:p-10">
            <p className="text-sm uppercase tracking-[0.28em] text-brand-500 font-bold">Acceso</p>
            <h1 id="login-brand-heading" className="mt-3 text-[1.9rem] font-bold text-white">Centro operativo</h1>
            <p className="mt-2 text-sm leading-6 text-stone-400">Ingresa con tu cuenta asignada. Los módulos y acciones se habilitan según tu rol.</p>

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
                <label htmlFor="login-email" className="mb-2 block text-sm font-medium text-stone-200">Correo electrónico</label>
                <Input
                  id="login-email"
                  data-testid="login-email"
                  {...register('email')}
                  placeholder="tu@correo.com"
                  autoComplete="username"
                  inputMode="email"
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={errors.email ? 'login-email-error' : undefined}
                  className="border-white/12 bg-black text-stone-50 placeholder:text-stone-500 focus:border-brand-500 focus:bg-black focus:ring-brand-500/20"
                />
                {errors.email ? <p id="login-email-error" role="alert" className="mt-2 text-sm text-red-400">{errors.email.message}</p> : null}
              </div>

              <div>
                <label htmlFor="login-password" className="mb-2 block text-sm font-medium text-stone-200">Contraseña</label>
                <Input
                  id="login-password"
                  data-testid="login-password"
                  {...register('password')}
                  type="password"
                  placeholder="Ingresa tu contraseña"
                  autoComplete="current-password"
                  aria-invalid={Boolean(errors.password)}
                  aria-describedby={errors.password ? 'login-password-error' : undefined}
                  className="border-white/12 bg-black text-stone-50 placeholder:text-stone-500 focus:border-brand-500 focus:bg-black focus:ring-brand-500/20"
                />
                {errors.password ? <p id="login-password-error" role="alert" className="mt-2 text-sm text-red-400">{errors.password.message}</p> : null}
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
    </main>
  );
}
