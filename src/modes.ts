export type ModeName = "plan" | "yolo" | "normal";

export class ModeManager {
  static readonly MODES: Record<ModeName, ModeName> = {
    plan: "plan",
    yolo: "yolo",
    normal: "normal",
  };

  private mode: ModeName = "normal";

  constructor(mode?: ModeName) {
    if (mode) this.setMode(mode);
  }

  setMode(name: string): ModeName {
    const key = name.trim().toLowerCase();
    if (!(key in ModeManager.MODES)) {
      throw new Error(
        `Unknown mode "${name}". Available: ${Object.keys(ModeManager.MODES).join(", ")}`
      );
    }
    this.mode = key as ModeName;
    return this.mode;
  }

  getMode(): ModeName {
    return this.mode;
  }

  getSystemPromptModifier(): string {
    switch (this.mode) {
      case "plan":
        return (
          "You are in PLAN mode. Do NOT modify files or run commands. " +
          "Explore only with ReadFile, Glob, Grep, ListDir. Produce a detailed plan."
        );
      case "yolo":
        return (
          "You are in YOLO mode. Proceed with all actions without asking for " +
          "confirmation. Be efficient and direct."
        );
      default:
        return "";
    }
  }

  requiresConfirmation(toolName: string): boolean {
    switch (this.mode) {
      case "plan":
        // Plan mode should not even expose these tools; if called, block.
        return true;
      case "yolo":
        return false;
      default:
        // Normal mode: confirm destructive actions.
        return (
          toolName === "Bash" ||
          toolName === "WriteFile" ||
          toolName === "EditFile"
        );
    }
  }

  allowedTools(mode?: ModeName): string[] {
    const m = (mode ?? this.mode) as ModeName;
    switch (m) {
      case "plan":
        return ["ReadFile", "Glob", "Grep", "ListDir"];
      case "yolo":
      case "normal":
      default:
        return [
          "ReadFile",
          "WriteFile",
          "EditFile",
          "ListDir",
          "Bash",
          "Glob",
          "Grep",
        ];
    }
  }
}
