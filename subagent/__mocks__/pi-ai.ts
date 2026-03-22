/**
 * Mock for @mariozechner/pi-ai
 */
export function StringEnum<T extends readonly string[]>(values: T) {
	return { type: "string", enum: values };
}
