type DefinedProperties<T extends Record<string, unknown>> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K];
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>;
};

/** Build an exact-optional object without assigning explicit `undefined` values. */
export function definedProps<const T extends Record<string, unknown>>(properties: T): DefinedProperties<T> {
  return Object.fromEntries(
    Object.entries(properties).filter(([, value]) => value !== undefined),
  ) as DefinedProperties<T>;
}
