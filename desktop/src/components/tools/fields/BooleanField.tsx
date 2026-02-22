import { useFormContext, Controller } from "react-hook-form";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import type { ToolFieldSchema } from "@/types/tool-schema";

interface FieldProps {
  field: ToolFieldSchema;
}

export function BooleanField({ field }: FieldProps) {
  const { control } = useFormContext();

  return (
    <div className="flex items-center justify-between rounded-lg border p-3">
      <div className="space-y-0.5">
        <Label htmlFor={field.name} className="text-sm">
          {field.label}
        </Label>
        {field.description && (
          <p className="text-xs text-muted-foreground">{field.description}</p>
        )}
      </div>
      <Controller
        name={field.name}
        control={control}
        render={({ field: rhf }) => (
          <Switch
            id={field.name}
            checked={rhf.value ?? false}
            onCheckedChange={rhf.onChange}
          />
        )}
      />
    </div>
  );
}
