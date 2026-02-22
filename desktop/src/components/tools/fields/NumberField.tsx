import { useFormContext } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ToolFieldSchema } from "@/types/tool-schema";

interface FieldProps {
  field: ToolFieldSchema;
}

export function NumberField({ field }: FieldProps) {
  const { register, formState: { errors } } = useFormContext();

  return (
    <div className="space-y-1.5">
      <Label htmlFor={field.name} className="text-sm">
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Input
        id={field.name}
        type="number"
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
        {...register(field.name, { valueAsNumber: true })}
        className="font-mono text-sm w-32"
      />
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
      {errors[field.name] && (
        <p className="text-xs text-destructive">
          {errors[field.name]?.message as string}
        </p>
      )}
    </div>
  );
}
