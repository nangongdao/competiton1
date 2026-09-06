import { Sun, Moon, MonitorSmartphone } from "lucide-react";
import * as Tooltip from "@radix-ui/react-tooltip";
import type { ThemeMode } from "../styles/use-theme.js";

interface Props {
  mode: ThemeMode;
  onCycle: () => void;
}

const LABEL: Record<ThemeMode, string> = {
  light: "亮色主题",
  dark: "暗色主题",
  system: "跟随系统",
};

/** 主题切换:light → dark → system 循环,图标随当前模式变化。 */
export function ThemeToggle({ mode, onCycle }: Props) {
  const Icon = mode === "light" ? Sun : mode === "dark" ? Moon : MonitorSmartphone;
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <button
          type="button"
          className={mode === "system" ? "btn-icon" : "btn-icon theme-active"}
          onClick={onCycle}
          aria-label={`切换主题(当前:${LABEL[mode]})`}
        >
          <Icon size={18} aria-hidden />
        </button>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tooltip" sideOffset={6}>
          {LABEL[mode]}
          <Tooltip.Arrow className="tooltip-arrow" />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
