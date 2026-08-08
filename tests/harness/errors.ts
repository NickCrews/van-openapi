/**
 * Narrows the standard `{errors: [{code, text, …}]}` envelope. Response bodies
 * are typed as the union of everything an operation documents, so a refusal has
 * to be narrowed before its fields can be read.
 */

export interface ApiError {
  code?: string;
  text?: string;
  hint?: string | null;
  properties?: string[] | null;
}

export function firstError(body: unknown): ApiError {
  const errors = (body as { errors?: ApiError[] }).errors;
  return errors?.[0] ?? {};
}
