/**
 * Configurations — centralized settings page.
 *
 * A single scrollable page with multi-column layout displaying every
 * user-configurable option in the app. Each section has its own
 * save/cancel buttons that appear only when that section has unsaved changes.
 * A global floating save bar appears when any section is dirty.
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
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useConfigurations,
  type ConfigSection,
} from "@/hooks/use-configurations";
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

// ── Main Page ────────────────────────────────────────────────────────────────

export function Configurations() {
  const [state, actions] = useConfigurations();
  const { draft, sectionDirty, isGlobalDirty, isSaving } = state;

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
                <SettingRow label="Default AI model" description="Cloud model used for new conversations">
                  <Input
                    value={draft.chatDefaultModel}
                    onChange={(e) => set("chatDefaultModel", e.target.value)}
                    className="w-48"
                    placeholder="claude-sonnet-4-6"
                  />
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
                <SettingRow label="Default system prompt ID" description="Leave empty for built-in assistant">
                  <Input
                    value={draft.chatDefaultSystemPromptId}
                    onChange={(e) => set("chatDefaultSystemPromptId", e.target.value)}
                    className="w-48"
                    placeholder="(built-in)"
                  />
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
                <SettingRow label="Default model" description="GGUF filename (empty = auto-detect)">
                  <Input
                    value={draft.llmDefaultModel}
                    onChange={(e) => set("llmDefaultModel", e.target.value)}
                    className="w-48"
                    placeholder="(auto)"
                  />
                </SettingRow>
                <SettingRow label="GPU layers" description="-1 = auto-detect based on hardware">
                  <NumberInput
                    value={draft.llmDefaultGpuLayers}
                    onChange={(v) => set("llmDefaultGpuLayers", v)}
                    min={-1}
                    max={999}
                  />
                </SettingRow>
                <SettingRow label="Context length">
                  <NumberInput
                    value={draft.llmDefaultContextLength}
                    onChange={(v) => set("llmDefaultContextLength", v)}
                    min={512}
                    max={131072}
                    step={512}
                  />
                </SettingRow>
                <SettingRow label="Auto-start server" description="Launch LLM server when app starts">
                  <Switch
                    checked={draft.llmAutoStartServer}
                    onCheckedChange={(v) => set("llmAutoStartServer", v)}
                  />
                </SettingRow>

                <Separator className="my-2" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Chat Sampling</p>

                <SettingRow label="Temperature">
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[draft.llmChatTemperature]}
                      onValueChange={([v]) => set("llmChatTemperature", v)}
                      min={0}
                      max={2}
                      step={0.05}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {draft.llmChatTemperature.toFixed(2)}
                    </span>
                  </div>
                </SettingRow>
                <SettingRow label="Top P">
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[draft.llmChatTopP]}
                      onValueChange={([v]) => set("llmChatTopP", v)}
                      min={0}
                      max={1}
                      step={0.05}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {draft.llmChatTopP.toFixed(2)}
                    </span>
                  </div>
                </SettingRow>
                <SettingRow label="Top K">
                  <NumberInput
                    value={draft.llmChatTopK}
                    onChange={(v) => set("llmChatTopK", v)}
                    min={1}
                    max={200}
                  />
                </SettingRow>
                <SettingRow label="Max tokens">
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
                <SettingRow label="Temperature">
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[draft.llmReasoningTemperature]}
                      onValueChange={([v]) => set("llmReasoningTemperature", v)}
                      min={0}
                      max={2}
                      step={0.05}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {draft.llmReasoningTemperature.toFixed(2)}
                    </span>
                  </div>
                </SettingRow>
                <SettingRow label="Top P">
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[draft.llmReasoningTopP]}
                      onValueChange={([v]) => set("llmReasoningTopP", v)}
                      min={0}
                      max={1}
                      step={0.05}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {draft.llmReasoningTopP.toFixed(2)}
                    </span>
                  </div>
                </SettingRow>

                <Separator className="my-2" />
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Tool Calling</p>

                <SettingRow label="Temperature">
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[draft.llmToolCallTemperature]}
                      onValueChange={([v]) => set("llmToolCallTemperature", v)}
                      min={0}
                      max={2}
                      step={0.05}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {draft.llmToolCallTemperature.toFixed(2)}
                    </span>
                  </div>
                </SettingRow>
                <SettingRow label="Top P">
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[draft.llmToolCallTopP]}
                      onValueChange={([v]) => set("llmToolCallTopP", v)}
                      min={0}
                      max={1}
                      step={0.05}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {draft.llmToolCallTopP.toFixed(2)}
                    </span>
                  </div>
                </SettingRow>
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

                <SettingRow label="Structured output temp" description="For JSON schema responses">
                  <div className="flex items-center gap-2">
                    <Slider
                      value={[draft.llmStructuredOutputTemperature]}
                      onValueChange={([v]) => set("llmStructuredOutputTemperature", v)}
                      min={0}
                      max={1}
                      step={0.05}
                      className="w-24"
                    />
                    <span className="text-xs text-muted-foreground w-8 text-right">
                      {draft.llmStructuredOutputTemperature.toFixed(2)}
                    </span>
                  </div>
                </SettingRow>
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
                <SettingRow label="Default Whisper model" description="Filename (empty = auto-detect)">
                  <Input
                    value={draft.transcriptionDefaultModel}
                    onChange={(e) => set("transcriptionDefaultModel", e.target.value)}
                    className="w-48"
                    placeholder="(auto)"
                  />
                </SettingRow>
                <SettingRow label="Auto-initialize on startup" description="Load transcription model when app starts">
                  <Switch
                    checked={draft.transcriptionAutoInit}
                    onCheckedChange={(v) => set("transcriptionAutoInit", v)}
                  />
                </SettingRow>
                <SettingRow label="Audio input device" description="Leave empty for system default">
                  <Input
                    value={draft.transcriptionAudioDevice}
                    onChange={(e) => set("transcriptionAudioDevice", e.target.value)}
                    className="w-48"
                    placeholder="(system default)"
                  />
                </SettingRow>
                <SettingRow label="Processing timeout (ms)" description="Force-reset if stuck longer than this">
                  <NumberInput
                    value={draft.transcriptionProcessingTimeout}
                    onChange={(v) => set("transcriptionProcessingTimeout", Math.max(1000, v))}
                    min={1000}
                    max={60000}
                    step={1000}
                    className="w-28"
                  />
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
                <SettingRow label="Detection engine">
                  <Select
                    value={draft.wakeWordEngine}
                    onValueChange={(v) => set("wakeWordEngine", v as AppSettings["wakeWordEngine"])}
                  >
                    <SelectTrigger className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="whisper">Whisper</SelectItem>
                      <SelectItem value="oww">OpenWakeWord</SelectItem>
                    </SelectContent>
                  </Select>
                </SettingRow>
                {draft.wakeWordEngine === "whisper" && (
                  <SettingRow label="Custom keyword" description="Phrase that triggers wake word">
                    <Input
                      value={draft.wakeWordCustomKeyword}
                      onChange={(e) => set("wakeWordCustomKeyword", e.target.value)}
                      className="w-40"
                    />
                  </SettingRow>
                )}
                {draft.wakeWordEngine === "oww" && (
                  <>
                    <SettingRow label="OWW model">
                      <Input
                        value={draft.wakeWordOwwModel}
                        onChange={(e) => set("wakeWordOwwModel", e.target.value)}
                        className="w-40"
                      />
                    </SettingRow>
                    <SettingRow label="Detection threshold" description="0.0 to 1.0 — higher = fewer false positives">
                      <div className="flex items-center gap-2">
                        <Slider
                          value={[draft.wakeWordOwwThreshold]}
                          onValueChange={([v]) => set("wakeWordOwwThreshold", v)}
                          min={0}
                          max={1}
                          step={0.05}
                          className="w-24"
                        />
                        <span className="text-xs text-muted-foreground w-8 text-right">
                          {draft.wakeWordOwwThreshold.toFixed(2)}
                        </span>
                      </div>
                    </SettingRow>
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
                <SettingRow label="Delay between requests (sec)" description="Wait time between page loads">
                  <Input
                    type="number"
                    value={draft.scrapeDelay}
                    onChange={(e) => set("scrapeDelay", e.target.value)}
                    min={0}
                    max={30}
                    step={0.5}
                    className="w-24 text-right"
                  />
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
