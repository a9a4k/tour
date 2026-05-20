import { theme } from "../core/theme.js";

interface FooterLineTuiProps {
  footer: string;
}

export function FooterLineTui({ footer }: FooterLineTuiProps) {
  return (
    <box height={1} width="100%" paddingX={1}>
      <text fg={theme.fg.muted} selectable={false}>{footer}</text>
    </box>
  );
}
