'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
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
  name: z.string().min(2, 'Ingresa tu nombre de acceso.'),
  accessCode: z.string().min(4, 'El codigo debe tener al menos 4 caracteres.'),
});

type FormValues = z.infer<typeof formSchema>;

export default function WaiterLoginPage() {
  const router = useRouter();
  const { user, loading, loginWaiter } = useAuth();
  const [error, setError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: '',
      accessCode: '',
    },
  });

  useEffect(() => {
    if (!loading && user) {
      router.replace(resolveDefaultRoute(user));
    }
  }, [loading, router, user]);

  return (
    <div
      data-testid="waiter-login-shell"
      className="relative min-h-screen overflow-x-hidden bg-black px-4 py-5 text-stone-50 sm:px-6 lg:py-6"
    >
      <div className="relative mx-auto grid min-h-[calc(100vh-2.5rem)] max-w-6xl items-start lg:items-center gap-6 lg:gap-12 lg:grid-cols-[1fr_420px]">
        <section className="flex items-center justify-center px-4 pt-6 pb-2 lg:py-0" aria-labelledby="waiter-login-brand">
          <div className="w-full max-w-[480px]">
            <Image src="/brand/sidebar-logo.png" alt="2X1 Burger Co." width={500} height={180} priority className="h-auto w-full object-contain" />
          </div>
        </section>

        <section className="flex items-center justify-center px-4">
          <Card className="relative w-full max-w-lg overflow-hidden border-brand-500/20 bg-black p-8 text-stone-50 lg:p-10">
            <p className="text-sm uppercase tracking-[0.28em] text-brand-500 font-bold">Acceso</p>
            <h2 className="mt-3 text-[1.9rem] font-bold text-white">Meseros</h2>
            <p className="mt-2 text-[13px] leading-6 text-stone-400">Ingresa con tu nombre y codigo de acceso para tomar pedidos.</p>

            <form className="mt-8 space-y-5" onSubmit={handleSubmit(async (values) => {
              try {
                setError(null);
                const user = await loginWaiter(values.name, values.accessCode);
                router.push(resolveDefaultRoute(user));
              } catch (caughtError) {
                setError(caughtError instanceof Error ? caughtError.message : 'No pudimos iniciar la sesion.');
              }
            })}>
              <div>
                <label className="mb-2 block text-sm font-medium text-stone-200">Nombre</label>
                <Input data-testid="waiter-login-name" {...register('name')} placeholder="Tu nombre de acceso"
                  className="border-white/12 bg-black text-stone-50 placeholder:text-stone-500 focus:border-brand-500 focus:ring-brand-500/20" />
                {errors.name ? <p className="mt-2 text-sm text-red-400">{errors.name.message}</p> : null}
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-stone-200">Codigo de acceso</label>
                <Input data-testid="waiter-login-code" {...register('accessCode')} type="password" placeholder="Ingresa tu codigo"
                  className="uppercase tracking-[0.18em] border-white/12 bg-black text-stone-50 placeholder:text-stone-500 focus:border-brand-500 focus:ring-brand-500/20" />
                {errors.accessCode ? <p className="mt-2 text-sm text-red-400">{errors.accessCode.message}</p> : null}
              </div>
              {error ? (
                <p role="alert" data-testid="waiter-login-error" className="rounded-2xl border border-red-400/25 bg-red-950/45 px-4 py-3 text-sm text-red-300">{error}</p>
              ) : null}
              <Button data-testid="waiter-login-submit" type="submit" size="lg" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? 'Entrando...' : 'Entrar como mesero'}
              </Button>
            </form>

          </Card>
        </section>
      </div>
    </div>
  );
}
