Add a documented `preserveUnderscores` option for generated slugs, with visible
tests and no behavior change for existing callers. When enabled, underscores
remain separators, repeated underscores collapse to one, and separators are
trimmed from both ends.
