import { z } from "zod";
const Port = z.coerce.number().int().min(0).max(65535);
export function parsePort(value, fallback = 8000) {
    const parsed = Port.safeParse(value ?? fallback);
    if (!parsed.success)
        throw new TypeError("INVALID_PORT");
    return parsed.data;
}
