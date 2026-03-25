/**
 * Configurations — centralized settings page.
 *
 * A single scrollable page with multi-column layout displaying every
 * user-configurable option in the app. Each section has its own
 * save/cancel buttons that appear only when that section has unsaved changes.
 * A global floating save bar appears when any section is dirty.
 *
 * All enum-like fields use real data: model catalogs from Rust/Tauri,
 * audio devices from CPAL, system prompts from the prompt library, and
 * cloud AI models from the engine database.
 */

import { useCallback } from "react";
import {
  Settings2,
  Palette,
  MessageSquare,
  BrainCircuit,
  Mic,
  Radio,
  Globe,
  Network,
  Bell,
  Monitor,
  Save,
  X,
  RotateCcw,
  Loader2,
  RefreshCw,
  Star,
  Cpu,
} from "lucide-react";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useConfigurations,
  type ConfigSection,
} from "@/hooks/use-configurations";
import { useConfigCatalogs } from "@/hooks/use-config-catalogs";
import type { AppSettings } from "@/lib/settings";
import { cn } from "@/lib/utils";

// ── Section save/cancel bar ──────────────────────────────────────────────────

function SectionActions({
  section,
  dirty,
  saving,
  onSave,
  onCancel,
}: {
  section: ConfigSection;
  dirty: boolean;
  saving: boolean;
  onSave: (s: ConfigSection) => void;
  onCancel: (s: ConfigSection) => void;
}) {
  if (!dirty) return null;
  return (
    <div className="flex items-center gap-2 pt-3 border-t mt-3">
      <Button
        size="sm"
        onClick={() => onSave(section)}
        disabled={saving}
        className="gap-1.5"
      >
        {saving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Save className="h-3.5 w-3.5" />
        )}
        Save
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={() => onCancel(section)}
        disabled={saving}
        className="gap-1.5"
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Cancel
      </Button>
    </div>
  );
}

// ── Reusable field components ────────────────────────────────────────────────

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex-1 min-w-0">
        <Label className="text-sm font-medium">{label}</Label>
        {description && (
          <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex-shrink-0">{children}</div>
    </div>
  );
}

function NumberInput({
  value,
  onChange,
  min,
  max,
  step,
  className,
}: {
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  className?: string;
}) {
  return (
    <Input
      type="number"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      min={min}
      max={max}
      step={step}
      className={cn("w-24 text-right", className)}
    />
  );
}

function SliderRow({
  label,
  description,
  value,
  onChange,
  min,
  max,
  step,
  decimals = 2,
}: {
  label: string;
  description?: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  decimals?: number;
}) {
  return (
    <SettingRow label={label} description={description}>
      <div className="flex items-center gap-2">
        <Slider
          value={[value]}
          onValueChange={([v]) => onChange(v)}
          min={min}
          max={max}
          step={step}
          className="w-24"
        />
        <span className="text-xs text-muted-foreground w-8 text-right tabular-nums">
          {value.toFixed(decimals)}
        </span>
      </div>
    </SettingRow>
  );
}

/** Format bytes to human-readable size */
function fmtSize(gb: number): string {
  if (gb < 1) return `${Math.round(gb * 1024)} MB`;
  return `${gb.toFixed(1)} GB`;
}

// ── Main Page ────────────────────────────────────────────────────────────────

export function Configurations() {
  const [state, actions] = useConfigurations();
  const { draft, sectionDirty, isGlobalDirty, isSaving } = state;
  const catalogs = useConfigCatalogs();

  const set = actions.set;
  const handleSave = useCallback(
    (s: ConfigSection) => actions.saveSection(s),
    [actions]
  );
  const handleCancel = useCallback(
    (s: ConfigSection) => actions.cancelSection(s),
    [actions]
  );

  if (!draft) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <PageHeader
        title="Configurations"
        description="Centralized control for every setting in the application"
      />

      <ScrollArea className="flex-1">
        <div className="p-6">
          {/* 3-column responsive grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">

            {/* ── Application ──────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Settings2 className="h-4 w-4" />
                  Application
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <SettingRow label="Launch on startup" description="Start the app when your computer boots">
                  <Switch
                    checked={draft.launchOnStartup}
                    onCheckedChange={(v) => set("launchOnStartup", v)}
                  />
                </SettingRow>
                <SettingRow label="Minimize to tray" description="Keep running in system tray when closed">
                  <Switch
                    checked={draft.minimizeToTray}
                    onCheckedChange={(v) => set("minimizeToTray", v)}
                  />
                </SettingRow>
                <SettingRow label="Instance name" description="Identify this computer in cloud sync">
                  <Input
                    value={draft.instanceName}
                    onChange={(e) => set("instanceName", e.target.value)}
                    className="w-40"
                  />
                </SettingRow>
                <Separator className="my-2" />
                <SettingRow label="Auto-check for updates">
                  <Switch
                    checked={draft.autoCheckUpdates}
                    onCheckedChange={(v) => set("autoCheckUpdates", v)}
                  />
                </SettingRow>
                <SettingRow label="Update check interval" description="Minutes between checks (min 60)">
                  <NumberInput
                    value={draft.updateCheckInterval}
                    onChange={(v) => set("updateCheckInterval", Math.max(60, v))}
                    min={60}
                    max={1440}
                    step={30}
                  />
                </SettingRow>
                <SectionActions
                  section="application"
                  dirty={sectionDirty.application}
                  saving={isSaving}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </CardContent>
            </Card>

            {/* ── Appearance ──────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Palette className="h-4 w-4" />
                  Appearance
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <SettingRow label="Theme" description="App color scheme">
                  <Select
                    value={draft.theme}
                    onValueChange={(v) => set("theme", v as AppSettings["theme"])}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SectionActions
                  section="appearance"
                  dirty={sectionDirty.appearance}
                  saving={isSaving}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </CardContent>
            </Card>

            {/* ── Chat & AI ──────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <MessageSquare className="h-4 w-4" />
                  Chat & AI
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <SettingRow label="Default AI model" description="Cloud model for new conversations">
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={draft.chatDefaultModel}
                      onValueChange={(v) => set("chatDefaultModel", v)}
                    >
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder="Select model..." />
                      </SelectTrigger>
                      <SelectContent>
                        {(() => {
                          // Group models by provider
                          const groups: Record<string, typeof catalogs.chatModels> = {};
                          for (const m of catalogs.chatModels) {
                            const p = m.provider;
                            if (!groups[p]) groups[p] = [];
                            groups[p].push(m);
                          }
                          return Object.entries(groups).map(([provider, models]) => (
                            <SelectGroup key={provider}>
                              <SelectLabel className="capitalize">{provider}</SelectLabel>
                              {models.map((m) => (
                                <SelectItem key={m.id} value={m.id}>
                                  <span className="flex items-center gap-1.5">
                                    {m.label}
                                    {m.is_primary && <Star className="h-3 w-3 text-yellow-500" />}
                                  </span>
                                </SelectItem>
                              ))}
                            </SelectGroup>
                          ));
                        })()}
                      </SelectContent>
                    </Select>
                    {catalogs.chatModelsLoading && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </SettingRow>
                <SettingRow label="Default chat mode">
                  <Select
                    value={draft.chatDefaultMode}
                    onValueChange={(v) => set("chatDefaultMode", v as AppSettings["chatDefaultMode"])}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chat">Chat</SelectItem>
                      <SelectItem value="co-work">Co-work</SelectItem>
                      <SelectItem value="code">Code</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Max conversations" description="Maximum stored chat conversations">
                  <NumberInput
                    value={draft.chatMaxConversations}
                    onChange={(v) => set("chatMaxConversations", Math.max(1, v))}
                    min={1}
                    max={500}
                  />
                </SettingRow>
                <SettingRow label="Default system prompt" description="Personality for new conversations">
                  <Select
                    value={draft.chatDefaultSystemPromptId || "__builtin__"}
                    onValueChange={(v) => set("chatDefaultSystemPromptId", v === "__builtin__" ? "" : v)}
                  >
                    <SelectTrigger className="w-52">
                      <SelectValue placeholder="Built-in Assistant" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__builtin__">
                        <span className="text-muted-foreground">Default (Built-in Assistant)</span>
                      </SelectItem>
                      {catalogs.systemPromptOptions.length > 0 && <Separator className="my-1" />}
                      {(() => {
                        const groups: Record<string, typeof catalogs.systemPromptOptions> = {};
                        for (const p of catalogs.systemPromptOptions) {
                          if (!groups[p.category]) groups[p.category] = [];
                          groups[p.category].push(p);
                        }
                        return Object.entries(groups).map(([cat, prompts]) => (
                          <SelectGroup key={cat}>
                            <SelectLabel>{cat}</SelectLabel>
                            {prompts.map((p) => (
                              <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
                            ))}
                          </SelectGroup>
                        ));
                      })()}
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SectionActions
                  section="chatAi"
                  dirty={sectionDirty.chatAi}
                  saving={isSaving}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </CardContent>
            </Card>

            {/* ── Local LLM ──────────────────────────────────── */}
            <Card className="xl:row-span-2">
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <BrainCircuit className="h-4 w-4" />
                  Local LLM
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <SettingRow label="Default model" description="Model used when starting the LLM server">
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={draft.llmDefaultModel || "__auto__"}
                      onValueChange={(v) => set("llmDefaultModel", v === "__auto__" ? "" : v)}
                    >
                      <SelectTrigger className="w-56">
                        <SelectValue placeholder="Auto-detect" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__auto__">
                          <span className="flex items-center gap-1.5">
                            <Cpu className="h-3 w-3" />
                            Auto-detect (hardware-based)
                          </span>
                        </SelectItem>
                        {catalogs.llmModels.length > 0 && <Separator className="my-1" />}
                        {catalogs.llmModels.map((m) => (
                          <SelectItem key={m.filename} value={m.filename}>
                            <div className="flex flex-col gap-0.5">
                              <span className="flex items-center gap-1.5">
                                {m.name}
                                {m.filename === catalogs.llmRecommended && (
                                  <span className="text-[10px] font-medium bg-primary/15 text-primary px-1.5 py-0.5 rounded">
                                    Recommended
                                  </span>
                                )}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {fmtSize(m.disk_size_gb)} disk
                                {" / "}
                                {fmtSize(m.ram_required_gb)} RAM
                                {" / "}
                                {m.speed}
                                {" / "}
                                Tool calling: {"★".repeat(m.tool_calling_rating)}{"☆".repeat(5 - m.tool_calling_rating)}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {catalogs.llmModelsLoading && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </SettingRow>
                <SettingRow label="GPU layers" description="-1 = auto-detect based on hardware">
                  <NumberInput
                    value={draft.llmDefaultGpuLayers}
                    onChange={(v) => set("llmDefaultGpuLayers", v)}
                    min={-1}
                    max={999}
                  />
                </SettingRow>
                <SettingRow label="Context length" description="Max tokens per conversation">
                  <Select
                    value={String(draft.llmDefaultContextLength)}
                    onValueChange={(v) => set("llmDefaultContextLength", Number(v))}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="2048">2,048</SelectItem>
                      <SelectItem value="4096">4,096</SelectItem>
                      <SelectItem value="8192">8,192</SelectItem>
                      <SelectItem value="16384">16,384</SelectItem>
                      <SelectItem value="32768">32,768</SelectItem>
                      <SelectItem value="65536">65,536</SelectItem>
                      <SelectItem value="131072">131,072</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SettingRow label="Auto-start server" description="Launch LLM server when app starts">
                  <Switch
                    checked={draft.llmAutoStartServer}
                    onCheckedChange={(v) => set("llmAutoStartServer", v)}
                  />
                </SettingRow>

                <Separator className="my-2" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Chat Sampling</p>

                <SliderRow
                  label="Temperature"
                  description="Higher = more creative, lower = more focused"
                  value={draft.llmChatTemperature}
                  onChange={(v) => set("llmChatTemperature", v)}
                  min={0} max={2} step={0.05}
                />
                <SliderRow
                  label="Top P"
                  description="Nucleus sampling threshold"
                  value={draft.llmChatTopP}
                  onChange={(v) => set("llmChatTopP", v)}
                  min={0} max={1} step={0.05}
                />
                <SettingRow label="Top K" description="Vocabulary filter size">
                  <NumberInput
                    value={draft.llmChatTopK}
                    onChange={(v) => set("llmChatTopK", v)}
                    min={1}
                    max={200}
                  />
                </SettingRow>
                <SettingRow label="Max tokens" description="Maximum response length">
                  <NumberInput
                    value={draft.llmChatMaxTokens}
                    onChange={(v) => set("llmChatMaxTokens", v)}
                    min={64}
                    max={32768}
                    step={64}
                  />
                </SettingRow>

                <Separator className="my-2" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reasoning Mode</p>

                <SettingRow label="Enable thinking" description="Use extended thinking by default">
                  <Switch
                    checked={draft.llmEnableThinking}
                    onCheckedChange={(v) => set("llmEnableThinking", v)}
                  />
                </SettingRow>
                <SliderRow
                  label="Temperature"
                  value={draft.llmReasoningTemperature}
                  onChange={(v) => set("llmReasoningTemperature", v)}
                  min={0} max={2} step={0.05}
                />
                <SliderRow
                  label="Top P"
                  value={draft.llmReasoningTopP}
                  onChange={(v) => set("llmReasoningTopP", v)}
                  min={0} max={1} step={0.05}
                />

                <Separator className="my-2" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tool Calling</p>

                <SliderRow
                  label="Temperature"
                  value={draft.llmToolCallTemperature}
                  onChange={(v) => set("llmToolCallTemperature", v)}
                  min={0} max={2} step={0.05}
                />
                <SliderRow
                  label="Top P"
                  value={draft.llmToolCallTopP}
                  onChange={(v) => set("llmToolCallTopP", v)}
                  min={0} max={1} step={0.05}
                />
                <SettingRow label="Top K">
                  <NumberInput
                    value={draft.llmToolCallTopK}
                    onChange={(v) => set("llmToolCallTopK", v)}
                    min={1}
                    max={200}
                  />
                </SettingRow>

                <Separator className="my-2" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Other</p>

                <SliderRow
                  label="Structured output temp"
                  description="For JSON schema responses"
                  value={draft.llmStructuredOutputTemperature}
                  onChange={(v) => set("llmStructuredOutputTemperature", v)}
                  min={0} max={1} step={0.05}
                />
                <SettingRow label="Stream max tokens">
                  <NumberInput
                    value={draft.llmStreamMaxTokens}
                    onChange={(v) => set("llmStreamMaxTokens", v)}
                    min={64}
                    max={32768}
                    step={64}
                  />
                </SettingRow>

                <SectionActions
                  section="localLlm"
                  dirty={sectionDirty.localLlm}
                  saving={isSaving}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </CardContent>
            </Card>

            {/* ── Voice & Transcription ───────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Mic className="h-4 w-4" />
                  Voice & Transcription
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <SettingRow label="Default Whisper model" description="Speech-to-text model quality">
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={draft.transcriptionDefaultModel || "__auto__"}
                      onValueChange={(v) => set("transcriptionDefaultModel", v === "__auto__" ? "" : v)}
                    >
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder="Auto-detect" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__auto__">
                          <span className="flex items-center gap-1.5">
                            <Cpu className="h-3 w-3" />
                            Auto-detect (hardware-based)
                          </span>
                        </SelectItem>
                        {catalogs.whisperModels.length > 0 && <Separator className="my-1" />}
                        {catalogs.whisperModels.map((m) => (
                          <SelectItem key={m.filename} value={m.filename}>
                            <div className="flex flex-col gap-0.5">
                              <span className="flex items-center gap-1.5">
                                {m.filename.replace("ggml-", "").replace(".bin", "")}
                                {m.filename === catalogs.whisperRecommended && (
                                  <span className="text-[10px] font-medium bg-primary/15 text-primary px-1.5 py-0.5 rounded">
                                    Recommended
                                  </span>
                                )}
                              </span>
                              <span className="text-[10px] text-muted-foreground">
                                {m.download_size_mb} MB download
                                {" / "}
                                {m.ram_required_mb} MB RAM
                                {" / "}
                                {m.relative_speed}
                                {" / "}
                                {m.accuracy}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {catalogs.whisperModelsLoading && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    )}
                  </div>
                </SettingRow>
                <SettingRow label="Auto-initialize on startup" description="Load transcription model when app starts">
                  <Switch
                    checked={draft.transcriptionAutoInit}
                    onCheckedChange={(v) => set("transcriptionAutoInit", v)}
                  />
                </SettingRow>
                <SettingRow label="Audio input device" description="Microphone for voice capture">
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={draft.transcriptionAudioDevice || "__default__"}
                      onValueChange={(v) => set("transcriptionAudioDevice", v === "__default__" ? "" : v)}
                    >
                      <SelectTrigger className="w-52">
                        <SelectValue placeholder="System default" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__default__">
                          <span className="text-muted-foreground">System default</span>
                        </SelectItem>
                        {catalogs.audioDevices.length > 0 && <Separator className="my-1" />}
                        {catalogs.audioDevices.map((d) => (
                          <SelectItem key={d.name} value={d.name}>
                            <span className="flex items-center gap-1.5">
                              {d.name}
                              {d.is_default && (
                                <span className="text-[10px] font-medium bg-green-500/15 text-green-500 px-1.5 py-0.5 rounded">
                                  Default
                                </span>
                              )}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => catalogs.refreshAudioDevices()}
                      disabled={catalogs.audioDevicesLoading}
                      title="Refresh devices"
                    >
                      {catalogs.audioDevicesLoading ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </SettingRow>
                <SettingRow label="Processing timeout" description="Force-reset if stuck longer than this">
                  <Select
                    value={String(draft.transcriptionProcessingTimeout)}
                    onValueChange={(v) => set("transcriptionProcessingTimeout", Number(v))}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="5000">5 sec</SelectItem>
                      <SelectItem value="10000">10 sec</SelectItem>
                      <SelectItem value="15000">15 sec</SelectItem>
                      <SelectItem value="30000">30 sec</SelectItem>
                      <SelectItem value="60000">60 sec</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SectionActions
                  section="voice"
                  dirty={sectionDirty.voice}
                  saving={isSaving}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </CardContent>
            </Card>

            {/* ── Wake Word ──────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Radio className="h-4 w-4" />
                  Wake Word
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <SettingRow label="Enabled" description="Master switch for wake word detection">
                  <Switch
                    checked={draft.wakeWordEnabled}
                    onCheckedChange={(v) => set("wakeWordEnabled", v)}
                  />
                </SettingRow>
                <SettingRow label="Listen on startup" description="Start listening when app launches">
                  <Switch
                    checked={draft.wakeWordListenOnStartup}
                    onCheckedChange={(v) => set("wakeWordListenOnStartup", v)}
                  />
                </SettingRow>
                <SettingRow label="Detection engine" description="Whisper = flexible keyword, OWW = trained models">
                  <Select
                    value={draft.wakeWordEngine}
                    onValueChange={(v) => set("wakeWordEngine", v as AppSettings["wakeWordEngine"])}
                  >
                    <SelectTrigger className="w-44">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="whisper">
                        <div className="flex flex-col">
                          <span>Whisper</span>
                          <span className="text-[10px] text-muted-foreground">Custom keyword phrase</span>
                        </div>
                      </SelectItem>
                      <SelectItem value="oww">
                        <div className="flex flex-col">
                          <span>OpenWakeWord</span>
                          <span className="text-[10px] text-muted-foreground">Trained neural models</span>
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                {draft.wakeWordEngine === "whisper" && (
                  <SettingRow label="Custom keyword" description="Phrase that triggers wake word">
                    <Input
                      value={draft.wakeWordCustomKeyword}
                      onChange={(e) => set("wakeWordCustomKeyword", e.target.value)}
                      className="w-40"
                      placeholder="hey matrix"
                    />
                  </SettingRow>
                )}
                {draft.wakeWordEngine === "oww" && (
                  <>
                    <SettingRow label="OWW model" description="Pre-trained wake word model">
                      <Select
                        value={draft.wakeWordOwwModel}
                        onValueChange={(v) => set("wakeWordOwwModel", v)}
                      >
                        <SelectTrigger className="w-44">
                          <SelectValue placeholder="Select model..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="hey_jarvis">Hey Jarvis</SelectItem>
                          <SelectItem value="hey_mycroft">Hey Mycroft</SelectItem>
                          <SelectItem value="alexa">Alexa</SelectItem>
                          <SelectItem value="hey_rhasspy">Hey Rhasspy</SelectItem>
                          <SelectItem value="timer">Timer</SelectItem>
                          <SelectItem value="weather">Weather</SelectItem>
                        </SelectContent>
                      </Select>
                    </SettingRow>
                    <SliderRow
                      label="Detection threshold"
                      description="Higher = fewer false positives"
                      value={draft.wakeWordOwwThreshold}
                      onChange={(v) => set("wakeWordOwwThreshold", v)}
                      min={0} max={1} step={0.05}
                    />
                  </>
                )}
                <SectionActions
                  section="wakeWord"
                  dirty={sectionDirty.wakeWord}
                  saving={isSaving}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </CardContent>
            </Card>

            {/* ── Scraping ──────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Globe className="h-4 w-4" />
                  Scraping
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <SettingRow label="Headless mode" description="Run browser without visible window">
                  <Switch
                    checked={draft.headlessScraping}
                    onCheckedChange={(v) => set("headlessScraping", v)}
                  />
                </SettingRow>
                <SettingRow label="Delay between requests" description="Wait time between page loads">
                  <Select
                    value={draft.scrapeDelay}
                    onValueChange={(v) => set("scrapeDelay", v)}
                  >
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0">None</SelectItem>
                      <SelectItem value="0.5">0.5 sec</SelectItem>
                      <SelectItem value="1.0">1.0 sec</SelectItem>
                      <SelectItem value="2.0">2.0 sec</SelectItem>
                      <SelectItem value="3.0">3.0 sec</SelectItem>
                      <SelectItem value="5.0">5.0 sec</SelectItem>
                      <SelectItem value="10.0">10 sec</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SectionActions
                  section="scraping"
                  dirty={sectionDirty.scraping}
                  saving={isSaving}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </CardContent>
            </Card>

            {/* ── Proxy & Network ─────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Network className="h-4 w-4" />
                  Proxy & Network
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <SettingRow label="Local proxy enabled" description="HTTP proxy at 127.0.0.1">
                  <Switch
                    checked={draft.proxyEnabled}
                    onCheckedChange={(v) => set("proxyEnabled", v)}
                  />
                </SettingRow>
                <SettingRow label="Proxy port">
                  <NumberInput
                    value={draft.proxyPort}
                    onChange={(v) => set("proxyPort", v)}
                    min={1024}
                    max={65535}
                  />
                </SettingRow>
                <Separator className="my-2" />
                <SettingRow label="Remote tunnel" description="Expose this instance via Cloudflare tunnel">
                  <Switch
                    checked={draft.tunnelEnabled}
                    onCheckedChange={(v) => set("tunnelEnabled", v)}
                  />
                </SettingRow>
                <SectionActions
                  section="proxy"
                  dirty={sectionDirty.proxy}
                  saving={isSaving}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </CardContent>
            </Card>

            {/* ── Notifications ──────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Bell className="h-4 w-4" />
                  Notifications
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <SettingRow label="Sound enabled" description="Play sound on notifications">
                  <Switch
                    checked={draft.notificationSound}
                    onCheckedChange={(v) => set("notificationSound", v)}
                  />
                </SettingRow>
                <SettingRow label="Sound style">
                  <Select
                    value={draft.notificationSoundStyle}
                    onValueChange={(v) => set("notificationSoundStyle", v as AppSettings["notificationSoundStyle"])}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="chime">Chime</SelectItem>
                      <SelectItem value="alert">Alert</SelectItem>
                      <SelectItem value="success">Success</SelectItem>
                      <SelectItem value="error">Error</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                <SectionActions
                  section="notifications"
                  dirty={sectionDirty.notifications}
                  saving={isSaving}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </CardContent>
            </Card>

            {/* ── UI / Layout ────────────────────────────────── */}
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Monitor className="h-4 w-4" />
                  UI & Layout
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-1">
                <SettingRow label="Sidebar collapsed by default" description="Start with sidebar minimized">
                  <Switch
                    checked={draft.sidebarCollapsed}
                    onCheckedChange={(v) => set("sidebarCollapsed", v)}
                  />
                </SettingRow>
                <SectionActions
                  section="ui"
                  dirty={sectionDirty.ui}
                  saving={isSaving}
                  onSave={handleSave}
                  onCancel={handleCancel}
                />
              </CardContent>
            </Card>

          </div>
        </div>
      </ScrollArea>

      {/* ── Global floating save bar ─────────────────────────────── */}
      {isGlobalDirty && (
        <div className="border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/75 px-6 py-3 flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            You have unsaved changes
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={actions.cancelAll}
              disabled={isSaving}
              className="gap-1.5"
            >
              <X className="h-3.5 w-3.5" />
              Discard all
            </Button>
            <Button
              size="sm"
              onClick={actions.saveAll}
              disabled={isSaving}
              className="gap-1.5"
            >
              {isSaving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save all changes
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
