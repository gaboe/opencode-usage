import { RefreshCw, Sun, Moon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/lib/use-theme";

type HeaderBarProps = {
  health: { status: string; version: string; timestamp: string } | null;
  healthError: boolean;
  onRefresh: () => void;
};

export function HeaderBar({ health, healthError, onRefresh }: HeaderBarProps) {
  const { theme, toggle } = useTheme();
  const resolved =
    theme === "system"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : theme;

  return (
    <header className="sticky top-0 z-50 flex h-11 shrink-0 items-center justify-between border-b border-border bg-background/95 backdrop-blur-sm px-5">
      <div className="flex items-center gap-3">
        <span className="text-sm font-bold tracking-tight">Commander</span>
        {health && (
          <span className="text-xs text-muted-foreground font-mono">
            v{health.version}
          </span>
        )}
      </div>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs">
          {healthError ? (
            <>
              <span className="inline-block size-2 rounded-full bg-destructive" />
              <span className="text-destructive">Disconnected</span>
            </>
          ) : health ? (
            <>
              <span className="inline-block size-2 rounded-full bg-primary" />
              <span className="text-primary">{health.status}</span>
            </>
          ) : (
            <span className="text-muted-foreground">Connecting…</span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={toggle}
          className="size-8 p-0"
        >
          {resolved === "dark" ? (
            <Sun className="size-3.5" />
          ) : (
            <Moon className="size-3.5" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onRefresh}
          className="size-8 p-0"
        >
          <RefreshCw className="size-3.5" />
        </Button>
      </div>
    </header>
  );
}
