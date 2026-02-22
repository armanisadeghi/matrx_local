import { useMemo } from "react";
import { useForm, FormProvider } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { schemaToZod } from "@/lib/schema-to-zod";
import { TextField } from "./fields/TextField";
import { TextareaField } from "./fields/TextareaField";
import { NumberField } from "./fields/NumberField";
import { BooleanField } from "./fields/BooleanField";
import { SelectField } from "./fields/SelectField";
import { FilePathField } from "./fields/FilePathField";
import { TagsField } from "./fields/TagsField";
import { KeyValueField } from "./fields/KeyValueField";
import type { ToolFieldSchema, ToolUISchema } from "@/types/tool-schema";

interface ToolFormProps {
  schema: ToolUISchema;
  onSubmit: (values: Record<string, unknown>) => void;
  loading?: boolean;
}

function renderField(field: ToolFieldSchema) {
  switch (field.type) {
    case "text":
      return <TextField key={field.name} field={field} />;
    case "textarea":
    case "code":
      return <TextareaField key={field.name} field={field} />;
    case "number":
      return <NumberField key={field.name} field={field} />;
    case "boolean":
      return <BooleanField key={field.name} field={field} />;
    case "select":
      return <SelectField key={field.name} field={field} />;
    case "file-path":
      return <FilePathField key={field.name} field={field} />;
    case "tags":
      return <TagsField key={field.name} field={field} />;
    case "key-value":
      return <KeyValueField key={field.name} field={field} />;
    case "json":
      return <TextareaField key={field.name} field={{ ...field, placeholder: field.placeholder ?? "{}" }} />;
    default:
      return <TextField key={field.name} field={field} />;
  }
}

export function ToolForm({ schema, onSubmit, loading }: ToolFormProps) {
  const zodSchema = useMemo(() => schemaToZod(schema.fields), [schema.fields]);

  const defaultValues = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const field of schema.fields) {
      if (field.defaultValue !== undefined) {
        values[field.name] = field.defaultValue;
      } else if (field.type === "boolean") {
        values[field.name] = false;
      } else if (field.type === "tags") {
        values[field.name] = [];
      } else if (field.type === "key-value") {
        values[field.name] = {};
      }
    }
    return values;
  }, [schema.fields]);

  const methods = useForm({
    resolver: zodResolver(zodSchema),
    defaultValues,
  });

  const handleSubmit = methods.handleSubmit((data) => {
    // Strip out undefined/empty values
    const cleaned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined && value !== "" && value !== null) {
        cleaned[key] = value;
      }
    }
    onSubmit(cleaned);
  });

  return (
    <FormProvider {...methods}>
      <form onSubmit={handleSubmit} className="space-y-4">
        {schema.fields.map(renderField)}
        <input type="submit" hidden disabled={loading} />
      </form>
    </FormProvider>
  );
}

// Export the form ref handle for external submit triggering
export { type ToolFormProps };
