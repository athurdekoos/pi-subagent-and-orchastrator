/**
 * Mock for @sinclair/typebox
 */
export const Type = {
	Object: (props: Record<string, unknown>) => ({ type: "object", properties: props }),
	String: (opts?: Record<string, unknown>) => ({ type: "string", ...opts }),
	Number: (opts?: Record<string, unknown>) => ({ type: "number", ...opts }),
	Boolean: (opts?: Record<string, unknown>) => ({ type: "boolean", ...opts }),
	Optional: (schema: unknown) => ({ ...schema as Record<string, unknown>, optional: true }),
	Array: (items: unknown) => ({ type: "array", items }),
	Record: (key: unknown, value: unknown, opts?: Record<string, unknown>) => ({
		type: "object",
		additionalProperties: value,
		...opts,
	}),
};
