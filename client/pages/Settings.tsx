import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import AppLayout from "@/components/layout/AppLayout";
import { useTheme } from "@/components/ThemeProvider";
import {
  Settings as SettingsIcon,
  EyeOff,
  Mic,
  Shield,
  Sliders,
  User,
  Mail,
  Calendar,
  Cloud,
  FileText,
  Presentation,
  AppWindow,
  CloudCog,
  FileSpreadsheet,
  Save,
  Loader2,
  AlertTriangle,
  Volume2,
  Skull,
  Fingerprint,
  Lock,
  Eye,
  Terminal,
  Clock,
  Cpu,
  Database,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { WraithSettings } from "@shared/api";

export default function Settings() {
  const queryClient = useQueryClient();
  const [settings, setSettings] = useState<WraithSettings | null>(null);
  const [hasChanges, setHasChanges] = useState(false);
  const { theme: currentTheme, setTheme } = useTheme();

  // ── Fetch settings ────────────────────────────────────────────

  const { data: serverSettings, isLoading } = useQuery<WraithSettings>({
    queryKey: ["settings"],
    queryFn: async () => {
      const res = await fetch("/api/settings");
      return res.json();
    },
  });

  useEffect(() => {
    if (serverSettings) {
      setSettings(serverSettings);
      // Apply saved theme on first load
      if (serverSettings.theme && serverSettings.theme !== currentTheme) {
        setTheme(serverSettings.theme);
      }
    }
  }, [serverSettings]);

  // ── Save mutation ──────────────────────────────────────────────

  const saveMutation = useMutation({
    mutationFn: async (patch: Partial<WraithSettings>) => {
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      setHasChanges(false);
    },
  });

  // ── Helpers ────────────────────────────────────────────────────

  function update<K extends keyof WraithSettings>(key: K, value: WraithSettings[K]) {
    if (!settings) return;
    setSettings({ ...settings, [key]: value });
    setHasChanges(true);
  }

  function updateNested(
    section: "permissions" | "ghostMode" | "voice" | "advanced",
    key: string,
    value: unknown,
  ) {
    if (!settings) return;
    const current = settings[section] as Record<string, unknown>;
    setSettings({
      ...settings,
      [section]: { ...current, [key]: value },
    } as WraithSettings);
    setHasChanges(true);
  }

  function handleSave() {
    if (!settings) return;
    saveMutation.mutate(settings);
  }

  if (isLoading || !settings) {
    return (
      <AppLayout>
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          {/* Header skeleton */}
          <div className="mb-8 flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Skeleton className="h-12 w-12 rounded-xl" />
              <div className="space-y-2">
                <Skeleton className="h-8 w-48" />
                <Skeleton className="h-4 w-72" />
              </div>
            </div>
            <Skeleton className="h-10 w-36 rounded-md" />
          </div>

          {/* Tabs skeleton */}
          <Skeleton className="mb-6 h-10 w-full max-w-lg rounded-md" />

          {/* Card skeleton */}
          <div className="rounded-xl border border-border bg-card">
            <div className="p-6 space-y-2">
              <Skeleton className="h-6 w-40" />
              <Skeleton className="h-4 w-64" />
            </div>
            <div className="px-6 pb-6 space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="h-10 w-full rounded-md" />
                </div>
                <div className="space-y-2">
                  <Skeleton className="h-4 w-16" />
                  <Skeleton className="h-10 w-full rounded-md" />
                </div>
              </div>
              <Skeleton className="h-px w-full" />
              {[1, 2].map((i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="space-y-1.5">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-3 w-48" />
                  </div>
                  <Skeleton className="h-6 w-11 rounded-full" />
                </div>
              ))}
            </div>
          </div>
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/10">
              <SettingsIcon className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h1 className="font-display text-2xl font-bold sm:text-3xl">Settings</h1>
              <p className="text-sm text-muted-foreground">
                Configure permissions, ghost mode behavior, and voice preferences.
              </p>
            </div>
          </div>
          <Button onClick={handleSave} disabled={!hasChanges || saveMutation.isPending}>
            {saveMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            Save Changes
          </Button>
        </div>

        {/* Unsaved indicator */}
        {hasChanges && (
          <div className="mb-6 flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
            <AlertTriangle className="h-4 w-4" />
            You have unsaved changes
          </div>
        )}

        {/* Tabs */}
        <Tabs defaultValue="general" className="space-y-6">
          <TabsList className="h-auto flex-wrap gap-1">
            <TabsTrigger value="general" className="gap-2">
              <User className="h-4 w-4" /> General
            </TabsTrigger>
            <TabsTrigger value="permissions" className="gap-2">
              <Shield className="h-4 w-4" /> Permissions
            </TabsTrigger>
            <TabsTrigger value="ghost" className="gap-2">
              <EyeOff className="h-4 w-4" /> Ghost Mode
            </TabsTrigger>
            <TabsTrigger value="voice" className="gap-2">
              <Mic className="h-4 w-4" /> Voice
            </TabsTrigger>
            <TabsTrigger value="advanced" className="gap-2">
              <Sliders className="h-4 w-4" /> Advanced
            </TabsTrigger>
          </TabsList>

          {/* ── General ──────────────────────────────────────────── */}
          <TabsContent value="general">
            <Card>
              <CardHeader>
                <CardTitle>General Settings</CardTitle>
                <CardDescription>Basic configuration for WRAITH.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="displayName">Display Name</Label>
                    <Input
                      id="displayName"
                      value={settings.displayName}
                      onChange={(e) => update("displayName", e.target.value)}
                      placeholder="Your name"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Theme</Label>
                    <div className="flex gap-2">
                      {([
                        { value: "dark" as const, label: "Dark", bg: "bg-[hsl(234,42%,5%)]", border: "border-[hsl(231,26%,16%)]" },
                        { value: "light" as const, label: "Light", bg: "bg-[hsl(0,0%,98%)]", border: "border-[hsl(240,6%,85%)]" },
                        { value: "system" as const, label: "System", bg: "bg-gradient-to-r from-[hsl(234,42%,5%)] to-[hsl(0,0%,98%)]", border: "border-[hsl(231,26%,16%)]" },
                      ]).map((t) => (
                        <button
                          key={t.value}
                          onClick={() => {
                            update("theme", t.value);
                            setTheme(t.value);
                          }}
                          className={cn(
                            "flex flex-1 flex-col items-center gap-1.5 rounded-lg border-2 p-2 transition-all",
                            settings.theme === t.value
                              ? "border-primary ring-2 ring-primary/20"
                              : "border-border hover:border-primary/40",
                          )}
                        >
                          <div className={cn("h-6 w-10 rounded-md border", t.bg, t.border)} />
                          <span className="text-[10px] font-medium text-muted-foreground">{t.label}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Notifications</p>
                      <p className="text-xs text-muted-foreground">Receive alerts for completed tasks</p>
                    </div>
                    <Switch
                      checked={settings.notifications}
                      onCheckedChange={(v) => update("notifications", v)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">Auto-start on boot</p>
                      <p className="text-xs text-muted-foreground">Launch WRAITH when the system starts</p>
                    </div>
                    <Switch
                      checked={settings.autoStart}
                      onCheckedChange={(v) => update("autoStart", v)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Permissions ───────────────────────────────────────── */}
          <TabsContent value="permissions">
            <Card>
              <CardHeader>
                <CardTitle>Permissions</CardTitle>
                <CardDescription>Control what WRAITH has access to on your system.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {([
                  { key: "email", icon: Mail, label: "Email", desc: "Read, draft, and send emails via Outlook" },
                  { key: "calendar", icon: Calendar, label: "Calendar", desc: "View and manage meetings and schedules" },
                  { key: "files", icon: Cloud, label: "File System", desc: "Access files on OneDrive and local storage" },
                  { key: "documents", icon: FileText, label: "Documents", desc: "Create and edit Word documents" },
                  { key: "presentations", icon: Presentation, label: "Presentations", desc: "Build and modify PowerPoint decks" },
                  { key: "dataAnalysis", icon: FileSpreadsheet, label: "Data Analysis", desc: "Read and write Excel spreadsheets" },
                  { key: "osControl", icon: AppWindow, label: "OS Control", desc: "Execute system-level commands on Windows" },
                  { key: "cloudInfrastructure", icon: CloudCog, label: "Cloud (Azure)", desc: "Manage Azure resources and services" },
                ] as const).map(({ key, icon: Icon, label, desc }) => (
                  <div key={key} className="flex items-center justify-between rounded-lg border border-border p-4 transition-colors hover:border-primary/30">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted">
                        <Icon className="h-5 w-5 text-secondary" />
                      </div>
                      <div>
                        <p className="text-sm font-medium">{label}</p>
                        <p className="text-xs text-muted-foreground">{desc}</p>
                      </div>
                    </div>
                    <Switch
                      checked={settings.permissions[key]}
                      onCheckedChange={(v) => updateNested("permissions", key, v)}
                    />
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Ghost Mode ────────────────────────────────────────── */}
          <TabsContent value="ghost">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <EyeOff className="h-5 w-5 text-ghost" />
                  Ghost Mode
                </CardTitle>
                <CardDescription>Configure stealth behavior to minimize WRAITH's footprint.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between rounded-lg border border-ghost/20 bg-ghost/5 p-4">
                  <div className="flex items-center gap-3">
                    <Skull className="h-5 w-5 text-ghost" />
                    <div>
                      <p className="text-sm font-medium">Enable Ghost Mode</p>
                      <p className="text-xs text-muted-foreground">Hide WRAITH activity from system logs</p>
                    </div>
                  </div>
                  <Switch
                    checked={settings.ghostMode.enabled}
                    onCheckedChange={(v) => updateNested("ghostMode", "enabled", v)}
                  />
                </div>

                <div className="space-y-3">
                  <Label>Stealth Level</Label>
                  <div className="flex gap-3">
                    {(["low", "medium", "high"] as const).map((level) => (
                      <button
                        key={level}
                        onClick={() => updateNested("ghostMode", "stealthLevel", level)}
                        className={cn(
                          "flex-1 rounded-lg border p-3 text-center text-sm font-medium transition-colors",
                          settings.ghostMode.stealthLevel === level
                            ? "border-ghost bg-ghost/10 text-ghost"
                            : "border-border text-muted-foreground hover:border-ghost/30",
                        )}
                      >
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                        <p className="mt-1 text-[10px] font-normal text-muted-foreground">
                          {level === "low" && "Basic log suppression"}
                          {level === "medium" && "Trace clearing + session rotation"}
                          {level === "high" && "Full stealth + encryption"}
                        </p>
                      </button>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Fingerprint className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Clear Traces</p>
                        <p className="text-xs text-muted-foreground">Remove temp files and browser history</p>
                      </div>
                    </div>
                    <Switch
                      checked={settings.ghostMode.clearTraces}
                      onCheckedChange={(v) => updateNested("ghostMode", "clearTraces", v)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Lock className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Rotate Session ID</p>
                        <p className="text-xs text-muted-foreground">Generate new session identity periodically</p>
                      </div>
                    </div>
                    <Switch
                      checked={settings.ghostMode.rotateSessionId}
                      onCheckedChange={(v) => updateNested("ghostMode", "rotateSessionId", v)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Eye className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Hide from Task Manager</p>
                        <p className="text-xs text-muted-foreground">Remove process from visible task lists</p>
                      </div>
                    </div>
                    <Switch
                      checked={settings.ghostMode.hideFromTaskManager}
                      onCheckedChange={(v) => updateNested("ghostMode", "hideFromTaskManager", v)}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Shield className="h-4 w-4 text-muted-foreground" />
                      <div>
                        <p className="text-sm font-medium">Encrypt Logs</p>
                        <p className="text-xs text-muted-foreground">Encrypt all activity logs at rest</p>
                      </div>
                    </div>
                    <Switch
                      checked={settings.ghostMode.encryptLogs}
                      onCheckedChange={(v) => updateNested("ghostMode", "encryptLogs", v)}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Voice ─────────────────────────────────────────────── */}
          <TabsContent value="voice">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Mic className="h-5 w-5 text-primary" />
                  Voice Settings
                </CardTitle>
                <CardDescription>Configure voice recognition and text-to-speech preferences.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium">Enable Voice</p>
                    <p className="text-xs text-muted-foreground">Allow voice commands and spoken responses</p>
                  </div>
                  <Switch
                    checked={settings.voice.enabled}
                    onCheckedChange={(v) => updateNested("voice", "enabled", v)}
                  />
                </div>

                {settings.voice.enabled && (
                  <>
                    <Separator />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>Wake Word</Label>
                        <Input
                          value={settings.voice.wakeWord}
                          onChange={(e) => updateNested("voice", "wakeWord", e.target.value)}
                          placeholder="Hey Wraith"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Voice</Label>
                        <Select
                          value={settings.voice.voiceName}
                          onValueChange={(v) => updateNested("voice", "voiceName", v)}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="Nova">Nova</SelectItem>
                            <SelectItem value="Echo">Echo</SelectItem>
                            <SelectItem value="Shimmer">Shimmer</SelectItem>
                            <SelectItem value="Onyx">Onyx</SelectItem>
                            <SelectItem value="Alloy">Alloy</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Speech Speed</Label>
                        <span className="text-sm font-mono text-muted-foreground">{settings.voice.speed.toFixed(1)}x</span>
                      </div>
                      <Slider
                        value={[settings.voice.speed]}
                        onValueChange={(v) => updateNested("voice", "speed", v[0])}
                        min={0.5}
                        max={2.0}
                        step={0.1}
                      />
                    </div>

                    <Separator />

                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Volume2 className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Auto-listen</p>
                            <p className="text-xs text-muted-foreground">Continuously listen for wake word</p>
                          </div>
                        </div>
                        <Switch
                          checked={settings.voice.autoListen}
                          onCheckedChange={(v) => updateNested("voice", "autoListen", v)}
                        />
                      </div>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Mic className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-medium">Push to Talk</p>
                            <p className="text-xs text-muted-foreground">Hold button to activate microphone</p>
                          </div>
                        </div>
                        <Switch
                          checked={settings.voice.pushToTalk}
                          onCheckedChange={(v) => updateNested("voice", "pushToTalk", v)}
                        />
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ── Advanced ──────────────────────────────────────────── */}
          <TabsContent value="advanced">
            <Card>
              <CardHeader>
                <CardTitle>Advanced Settings</CardTitle>
                <CardDescription>Fine-tune WRAITH's behavior and resource usage.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="text-sm font-medium">Debug Mode</p>
                      <p className="text-xs text-muted-foreground">Enable verbose logging for troubleshooting</p>
                    </div>
                  </div>
                  <Switch
                    checked={settings.advanced.debugMode}
                    onCheckedChange={(v) => updateNested("advanced", "debugMode", v)}
                  />
                </div>

                <Separator />

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" /> Log Retention
                    </Label>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[settings.advanced.logRetentionDays]}
                        onValueChange={(v) => updateNested("advanced", "logRetentionDays", v[0])}
                        min={1}
                        max={90}
                        step={1}
                        className="flex-1"
                      />
                      <span className="w-12 text-right text-sm font-mono text-muted-foreground">
                        {settings.advanced.logRetentionDays}d
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Cpu className="h-3.5 w-3.5" /> Max Concurrent Tasks
                    </Label>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[settings.advanced.maxConcurrentTasks]}
                        onValueChange={(v) => updateNested("advanced", "maxConcurrentTasks", v[0])}
                        min={1}
                        max={20}
                        step={1}
                        className="flex-1"
                      />
                      <span className="w-12 text-right text-sm font-mono text-muted-foreground">
                        {settings.advanced.maxConcurrentTasks}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Database className="h-3.5 w-3.5" /> Command History Size
                    </Label>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[settings.advanced.commandHistorySize]}
                        onValueChange={(v) => updateNested("advanced", "commandHistorySize", v[0])}
                        min={50}
                        max={500}
                        step={50}
                        className="flex-1"
                      />
                      <span className="w-12 text-right text-sm font-mono text-muted-foreground">
                        {settings.advanced.commandHistorySize}
                      </span>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label className="flex items-center gap-2">
                      <Clock className="h-3.5 w-3.5" /> API Timeout
                    </Label>
                    <div className="flex items-center gap-2">
                      <Slider
                        value={[settings.advanced.apiTimeout]}
                        onValueChange={(v) => updateNested("advanced", "apiTimeout", v[0])}
                        min={5}
                        max={120}
                        step={5}
                        className="flex-1"
                      />
                      <span className="w-12 text-right text-sm font-mono text-muted-foreground">
                        {settings.advanced.apiTimeout}s
                      </span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
