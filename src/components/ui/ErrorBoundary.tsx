import { AlertTriangle, Copy, RefreshCw, RotateCcw } from "lucide-react";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./Button";
import { errText } from "../../lib/errors";
import { logError } from "../../lib/log";

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
    console.error("ErrorBoundary caught:", error, info.componentStack);
    logError(`ErrorBoundary: ${errText(error)}${info.componentStack ?? ""}`);
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
      <div className="flex h-screen w-screen items-center justify-center bg-app p-6">
        <div className="flex w-full max-w-[480px] flex-col gap-4 rounded-2xl bg-app-panel p-6 shadow-xl ring-1 ring-black/5 dark:ring-white/10">
          <div className="flex flex-col gap-1">
            <div className="flex items-center gap-2 text-base font-semibold">
              <AlertTriangle size={18} className="text-app-danger" />
              界面出错了
            </div>
            <div className="text-sm text-app-secondary">数据没有受影响。</div>
          </div>

          <div className="selectable max-h-48 overflow-auto rounded-lg bg-app-subtle px-3 py-2 text-xs">
            <div className="font-medium text-app-danger">{errText(error, "未知错误")}</div>
            {stack && <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-2xs text-app-muted">{stack.trim()}</pre>}
          </div>

          <div className="flex items-center gap-2">
            <Button variant="ghost" icon={<Copy size={14} />} onClick={this.copy} className="mr-auto text-app-secondary">
              {copied ? "已复制" : "复制错误信息"}
            </Button>
            <Button icon={<RefreshCw size={14} />} onClick={this.reload}>
              重新加载
            </Button>
            <Button variant="primary" icon={<RotateCcw size={14} />} onClick={this.reset}>
              重试
            </Button>
          </div>
        </div>
      </div>
    );
  }
}
