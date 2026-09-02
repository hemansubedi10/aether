import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

export interface Skill {
  name: string;
  description: string;
  arguments: string[];
  template: string;
}

export class Skills {
  private dir: string;
  private skills: Map<string, Skill>;

  constructor(dir?: string) {
    this.dir = dir ?? path.join(os.homedir(), ".aether", "skills");
    this.skills = new Map();
    this.load();
  }

  private load(): void {
    try {
      if (!fs.existsSync(this.dir)) {
        this.ensureDefault();
        return;
      }
      const files = fs.readdirSync(this.dir).filter((f) => f.endsWith(".md"));
      for (const f of files) {
        const skill = this.parseFile(path.join(this.dir, f));
        if (skill) this.skills.set(skill.name, skill);
      }
      if (this.skills.size === 0) this.ensureDefault();
    } catch {
      this.ensureDefault();
    }
  }

  private ensureDefault(): void {
    const def: Skill = {
      name: "explain",
      description: "Explain a concept in simple terms",
      arguments: ["topic"],
      template: "Explain {{topic}} in simple terms with an analogy. Keep it under 200 words."
    };
    this.skills.set(def.name, def);
    try {
      fs.mkdirSync(this.dir, { recursive: true });
      const file = path.join(this.dir, "explain.md");
      if (!fs.existsSync(file)) {
        fs.writeFileSync(file, `---\nname: explain\ndescription: Explain a concept in simple terms\narguments:\n  - topic\n---\n\nExplain {{topic}} in simple terms with an analogy. Keep it under 200 words.`, "utf8");
      }
    } catch {
      // best effort
    }
  }

  private parseFile(file: string): Skill | null {
    try {
      const raw = fs.readFileSync(file, "utf8");
      const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
      if (!fmMatch) return null;
      const fm = fmMatch[1];
      const body = fmMatch[2].trim();
      const name = fm.match(/^name:\s*(.+)$/m)?.[1].trim() ?? "";
      const description = fm.match(/^description:\s*(.+)$/m)?.[1].trim() ?? "";
      const argsSection = fm.match(/^arguments:\s*\n((?:\s+-\s*.+\n?)+)/m);
      const args: string[] = [];
      if (argsSection) {
        const re = /^\s+-\s*(.+)$/gm;
        let m;
        while ((m = re.exec(argsSection[1])) !== null) args.push(m[1].trim());
      }
      if (!name) return null;
      return { name, description, arguments: args, template: body };
    } catch {
      return null;
    }
  }

  list(): Skill[] {
    return Array.from(this.skills.values());
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  render(name: string, args: Record<string, string>): string {
    const skill = this.skills.get(name);
    if (!skill) return `ERROR: unknown skill "${name}"`;
    let out = skill.template;
    for (const [k, v] of Object.entries(args)) {
      out = out.replace(new RegExp(`{{${k}}}`, "g"), v);
    }
    // Replace any remaining {{arg}} with the joined args string.
    out = out.replace(/{{(\w+)}}/g, (_, k) => args[k] ?? "");
    return out;
  }

  private static instance_: Skills | null = null;
  static instance(): Skills {
    if (!Skills.instance_) Skills.instance_ = new Skills();
    return Skills.instance_;
  }
}
