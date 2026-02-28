import { Component, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: unknown) {
    console.error("ErrorBoundary caught:", error, info);
  }

  render() {
    if (this.state.error) {
      return (
        this.props.fallback ?? (
          <div className="flex flex-col items-center justify-center h-64 gap-4">
            <p className="text-destructive font-medium">Something went wrong</p>
            <p className="text-muted-foreground text-sm">
              {this.state.error.message}
            </p>
            <Button
              variant="outline"
              onClick={() => this.setState({ error: null })}
            >
              Retry
            </Button>
          </div>
        )
      );
    }
    return this.props.children;
  }
}
