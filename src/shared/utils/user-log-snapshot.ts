/**
 * Mantém logs úteis sem duplicar senha, JWT, credenciais iFood ou outros
 * segredos do usuário dentro de log_entity.
 */
export function toSafeUserLogSnapshot(user: any) {
  if (!user) return {};

  return {
    id: user.id ?? null,
    name: user.name ?? '',
    user: user.user ?? '',
    phone: user.phone ?? '',
    type: user.type ?? null,
    permission: user.permission ?? null,
    cityId: user.cityId ?? null,
    isActive: user.isActive !== false,
  } as any;
}
