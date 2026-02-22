import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface SubTab {
  value: string;
  label: string;
}

interface SubTabBarProps {
  tabs: SubTab[];
  value: string;
  onValueChange: (value: string) => void;
}

export function SubTabBar({ tabs, value, onValueChange }: SubTabBarProps) {
  return (
    <div className="no-select flex h-10 items-center border-b px-6">
      <Tabs value={value} onValueChange={onValueChange}>
        <TabsList className="h-8 bg-transparent p-0 gap-1">
          {tabs.map((tab) => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="h-7 rounded-md px-3 text-sm font-medium data-[state=active]:bg-accent data-[state=active]:text-accent-foreground data-[state=inactive]:text-muted-foreground"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
