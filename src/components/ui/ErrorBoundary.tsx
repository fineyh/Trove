import { AlertTriangle, Copy, RefreshCw, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { errText } from "../../lib/errors";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  stack: string | null;
  copied: boolean;
}

/** 渲染期抛错时兜住白屏。只能接**渲染/生命周期**里的同步异常 ——
 *  事件回调与 Promise 的失败走 toast（stores/toast.ts）与 lib/globalErrors.ts。 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, stack: null, copied: false };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 没有落盘日志，控制台是目前唯一的开发者线索（见 todo「无落盘日志」）
    console.error("ErrorBoundary caught:", error, info.componentStack);
    this.setState({ stack: info.componentStack ?? null });
  }

  private reset = () => {
    this.setState({ error: null, stack: null, copied: false });
  };

  private reload = () => {
    window.location.reload();
  };

  private copy = async () => {
    const { error, stack } = this.state;
    const text = [errText(error), stack ?? ""].join("\n").trim();
    try {
      await navigator.clipboard.writeText(text);
      this.setState({ copied: true });
    } catch {
      // 复制失败就算了，错误信息本身在屏幕上是可选中的
    }
  };

  render() {
    const { error, stack, copied } = this.state;
    if (!error) return this.props.children;

    return (
      <div className="flex h-screen w-screen items-center justify-center p-6">
        <div className="flex w-full max-w-lg flex-col gap-4 rounded-2xl border border-app-border bg-app-panel p-6 shadow-2xl">
          <div className="flex items-center gap-2.5">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-500/10 text-red-500">
              <AlertTriangle size={20} />
            </div>
            <div className="flex flex-col">
              <div className="text-base font-semibold">界面出错了</div>
              <div className="text-xs text-app-muted">
                你的数据没有受影响，重试或重新加载即可。
              </div>
            </div>
          </div>

          <div className="max-h-48 select-text overflow-auto rounded-md border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-500">
            <div className="font-medium">{errText(error, "未知渲染错误")}</div>
            {stack && (
              <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[11px] text-app-muted">
                {stack.trim()}
              </pre>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={this.reset}
              className="flex items-center gap-1.5 rounded-md bg-app-accent px-3 py-2 text-sm text-white hover:opacity-90"
            >
              <RotateCcw size={14} />
              重试
            </button>
            <button
              type="button"
              onClick={this.reload}
              className="flex items-center gap-1.5 rounded-md border border-app-border px-3 py-2 text-sm hover:bg-app-subtle"
            >
              <RefreshCw size={14} />
              重新加载
            </button>
            <button
              type="button"
              onClick={this.copy}
              className="ml-auto flex items-center gap-1.5 rounded-md border border-app-border px-3 py-2 text-sm text-app-muted hover:bg-app-subtle hover:text-app-fg"
            >
              <Copy size={14} />
              {copied ? "已复制" : "复制错误信息"}
            </button>
          </div>
        </div>
      </div>
    );
  }
}
