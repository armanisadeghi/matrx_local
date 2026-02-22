import { z } from "zod";
import type { ToolFieldSchema } from "@/types/tool-schema";

/**
 * Converts an array of ToolFieldSchema definitions into a Zod object schema.
 * Used at runtime to validate tool form inputs before submission.
 */
export function schemaToZod(fields: ToolFieldSchema[]): z.ZodObject<Record<string, z.ZodTypeAny>> {
  const shape: Record<string, z.ZodTypeAny> = {};

  for (const field of fields) {
    let schema: z.ZodTypeAny;

    switch (field.type) {
      case "text":
      case "textarea":
      case "code":
      case "file-path": {
        let s = z.string();
        if (field.min != null) s = s.min(field.min);
        if (field.max != null) s = s.max(field.max);
        if (field.pattern) s = s.regex(new RegExp(field.pattern));
        schema = s;
        break;
      }

      case "number": {
        let n = z.number();
        if (field.min != null) n = n.min(field.min);
        if (field.max != null) n = n.max(field.max);
        schema = n;
        break;
      }

      case "boolean":
        schema = z.boolean();
        break;

      case "select": {
        if (field.options && field.options.length > 0) {
          const values = field.options.map((o) => o.value) as [string, ...string[]];
          schema = z.enum(values);
        } else {
          schema = z.string();
        }
        break;
      }

      case "tags":
        schema = z.array(z.string());
        break;

      case "key-value":
        schema = z.record(z.string(), z.string());
        break;

      case "json":
        schema = z.any();
        break;

      default:
        schema = z.any();
    }

    // Apply default value
    if (field.defaultValue !== undefined) {
      schema = schema.default(field.defaultValue);
    }

    // Make optional if not required
    if (!field.required) {
      schema = schema.optional();
    }

    shape[field.name] = schema;
  }

  return z.object(shape);
}
