export function stripMemoryResponseFields<
  T extends { id?: number; created_at?: string; updated_at?: string },
>(obj: T): Omit<T, 'id' | 'created_at' | 'updated_at'> {
  const { id: _id, created_at: _created_at, updated_at: _updated_at, ...rest } = obj;
  return rest;
}
