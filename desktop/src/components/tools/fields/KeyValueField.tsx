import { useFormContext, Controller } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Plus, X } from "lucide-react";
import type { ToolFieldSchema } from "@/types/tool-schema";

interface FieldProps {
  field: ToolFieldSchema;
}

export function KeyValueField({ field }: FieldProps) {
  const { control } = useFormContext();

  return (
    <div className="space-y-1.5">
      <Label className="text-sm">
        {field.label}
        {field.required && <span className="text-destructive ml-0.5">*</span>}
      </Label>
      <Controller
        name={field.name}
        control={control}
        render={({ field: rhf }) => {
          const obj: Record<string, string> = rhf.value ?? {};
          const entries = Object.entries(obj);

          const updateEntry = (
            oldKey: string,
            newKey: string,
            newValue: string
          ) => {
            const updated = { ...obj };
            if (oldKey !== newKey) delete updated[oldKey];
            updated[newKey] = newValue;
            rhf.onChange(updated);
          };

          const removeEntry = (key: string) => {
            const updated = { ...obj };
            delete updated[key];
            rhf.onChange(updated);
          };

          const addEntry = () => {
            const key = `key${entries.length + 1}`;
            rhf.onChange({ ...obj, [key]: "" });
          };

          return (
            <div className="space-y-2">
              {entries.map(([key, value], i) => (
                <div key={i} className="flex gap-2 items-center">
                  <Input
                    value={key}
                    onChange={(e) => updateEntry(key, e.target.value, value)}
                    placeholder="Key"
                    className="font-mono text-xs flex-1"
                  />
                  <Input
                    value={value}
                    onChange={(e) => updateEntry(key, key, e.target.value)}
                    placeholder="Value"
                    className="font-mono text-xs flex-1"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    onClick={() => removeEntry(key)}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={addEntry}
              >
                <Plus className="h-3.5 w-3.5" />
                Add Entry
              </Button>
            </div>
          );
        }}
      />
      {field.description && (
        <p className="text-xs text-muted-foreground">{field.description}</p>
      )}
    </div>
  );
}
